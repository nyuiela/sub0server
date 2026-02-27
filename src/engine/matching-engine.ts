/**
 * Matching Engine: Price-Time Priority Order Book
 *
 * RACE CONDITION PREVENTION (critical for high-frequency agent bursts):
 * This module is stateless per OrderBook instance. Concurrency control is
 * enforced by the caller: order-queue.ts guarantees that for a given marketId
 * only one processOrder() runs at a time. No locks are needed inside this file
 * as long as the single-threaded queue contract is honoured. Do NOT call
 * processOrder for the same market from multiple async contexts concurrently.
 */

import Decimal from "decimal.js";
import type {
  EngineOrder,
  OrderInput,
  OrderBookLevel,
  OrderBookSnapshot,
  ProcessOrderResult,
  ExecutedTrade,
  OrderSide,
} from "../types/order-book.js";

/** Default precision for price/quantity string serialization. */
const DECIMAL_PLACES = 18;

type DecimalInstance = import("decimal.js").default;
const DecimalCtor = ((Decimal as unknown as { default?: unknown }).default ?? Decimal) as new (v: string | number) => DecimalInstance;

function toDecimal(v: string | number): DecimalInstance {
  return new DecimalCtor(String(v));
}

/**
 * In-memory order book for one (market, outcome). Each listed option has its own book.
 * - Bids: sorted by price descending, then time ascending (FIFO at each level).
 * - Asks: sorted by price ascending, then time ascending.
 */
export class OrderBook {
  private readonly marketId: string;
  private readonly outcomeIndex: number;
  /** Map: price key -> list of orders at that price (FIFO). */
  private readonly bids: Map<string, EngineOrder[]> = new Map();
  private readonly asks: Map<string, EngineOrder[]> = new Map();
  /** Sorted bid prices (desc) for O(1) best bid. */
  private readonly bidPrices: string[] = [];
  /** Sorted ask prices (asc) for O(1) best ask. */
  private readonly askPrices: string[] = [];
  private orderCounter = 0;

  constructor(marketId: string, outcomeIndex: number) {
    this.marketId = marketId;
    this.outcomeIndex = outcomeIndex;
  }

  /**
   * Best bid price (highest). Returns null if no bids.
   */
  private bestBidPrice(): string | null {
    for (const p of this.bidPrices) {
      const list = this.bids.get(p);
      if (list !== undefined && list.length > 0) return p;
    }
    return null;
  }

  /**
   * Best ask price (lowest). Returns null if no asks.
   */
  private bestAskPrice(): string | null {
    for (const p of this.askPrices) {
      const list = this.asks.get(p);
      if (list !== undefined && list.length > 0) return p;
    }
    return null;
  }

  /**
   * Insert price into sorted array. Bids: descending. Asks: ascending.
   */
  private insertPriceSorted(prices: string[], priceStr: string, descending: boolean): void {
    const idx = prices.findIndex((p) =>
      descending ? new DecimalCtor(p).lt(priceStr) : new DecimalCtor(p).gt(priceStr)
    );
    if (idx === -1) prices.push(priceStr);
    else prices.splice(idx, 0, priceStr);
  }

  private removePriceFromSorted(prices: string[], priceStr: string): void {
    const i = prices.indexOf(priceStr);
    if (i !== -1) prices.splice(i, 1);
  }

  /**
   * Add a resting order to the book. Call only after matching is done for the incoming order.
   */
  private addToBook(order: EngineOrder): void {
    const key = order.price;
    if (order.side === "BID") {
      let list = this.bids.get(key);
      if (list === undefined) {
        list = [];
        this.bids.set(key, list);
        this.insertPriceSorted(this.bidPrices, key, true);
      }
      list.push(order);
    } else {
      let list = this.asks.get(key);
      if (list === undefined) {
        list = [];
        this.asks.set(key, list);
        this.insertPriceSorted(this.askPrices, key, false);
      }
      list.push(order);
    }
  }

  /**
   * Remove an order from the book (when fully filled or cancelled).
   */
  private removeFromBook(order: EngineOrder): void {
    const key = order.price;
    const map = order.side === "BID" ? this.bids : this.asks;
    const list = map.get(key);
    if (!list) return;
    const i = list.indexOf(order);
    if (i !== -1) list.splice(i, 1);
    if (list.length === 0) {
      map.delete(key);
      const arr = order.side === "BID" ? this.bidPrices : this.askPrices;
      this.removePriceFromSorted(arr, key);
    }
  }

  /**
   * Get the best opposite-side order for matching. Bids match against best ask, asks against best bid.
   */
  private getBestOpposite(side: OrderSide): { priceStr: string; order: EngineOrder } | null {
    if (side === "BID") {
      const p = this.bestAskPrice();
      if (p === null) return null;
      const list = this.asks.get(p)!;
      return list.length > 0 ? { priceStr: p, order: list[0] } : null;
    } else {
      const p = this.bestBidPrice();
      if (p === null) return null;
      const list = this.bids.get(p)!;
      return list.length > 0 ? { priceStr: p, order: list[0] } : null;
    }
  }

  /**
   * Cross the spread: fill taker against maker at maker's price (price-time priority).
   * Returns the trade and updates maker/taker remainingQty; removes maker if filled.
   */
  private matchOne(
    taker: EngineOrder,
    maker: EngineOrder,
    makerPriceStr: string,
    executedAt: number
  ): ExecutedTrade {
    const takerRem = new DecimalCtor(taker.remainingQty);
    const makerRem = new DecimalCtor(maker.remainingQty);
    const fillQty = takerRem.lte(makerRem) ? takerRem : makerRem;

    maker.remainingQty = makerRem.minus(fillQty).toFixed(DECIMAL_PLACES);
    taker.remainingQty = takerRem.minus(fillQty).toFixed(DECIMAL_PLACES);

    if (new DecimalCtor(maker.remainingQty).lte(0)) {
      maker.status = "FILLED";
      this.removeFromBook(maker);
    } else {
      maker.status = "PARTIALLY_FILLED";
    }

    const tradeId = `trade-${this.marketId}-${this.outcomeIndex}-${++this.orderCounter}-${Date.now()}`;
    return {
      id: tradeId,
      marketId: this.marketId,
      outcomeIndex: this.outcomeIndex,
      price: new DecimalCtor(makerPriceStr).toFixed(DECIMAL_PLACES),
      quantity: fillQty.toFixed(DECIMAL_PLACES),
      makerOrderId: maker.id,
      takerOrderId: taker.id,
      side: taker.side,
      userId: taker.userId ?? undefined,
      agentId: taker.agentId ?? undefined,
      makerUserId: maker.userId ?? undefined,
      makerAgentId: maker.agentId ?? undefined,
      executedAt,
    };
  }

  /**
   * Process one order: match against the book, then add remainder to book if LIMIT.
   * LIMIT: add resting quantity to book.
   * MARKET/IOC: do not add; any remainder is cancelled (IOC) or order rejected (MARKET if no fill).
   */
  processOrder(input: OrderInput): ProcessOrderResult {
    const quantity = toDecimal(String(input.quantity));
    if (quantity.lte(0)) {
      const emptySnapshot = this.getSnapshot();
      const rejected: EngineOrder = {
        id: input.id,
        marketId: input.marketId,
        outcomeIndex: input.outcomeIndex,
        side: input.side,
        type: input.type,
        price: "0",
        quantity: quantity.toFixed(DECIMAL_PLACES),
        remainingQty: "0",
        status: "REJECTED",
        createdAt: Date.now(),
        userId: input.userId,
        agentId: input.agentId,
        crePayload: input.crePayload ?? null,
      };
      return { order: rejected, trades: [], orderBookSnapshot: emptySnapshot };
    }

    const priceVal =
      input.type === "LIMIT" && input.price != null
        ? toDecimal(String(input.price))
        : new DecimalCtor(0);
    if (input.type === "LIMIT" && priceVal.lte(0)) {
      const emptySnapshot = this.getSnapshot();
      const rejected: EngineOrder = {
        id: input.id,
        marketId: input.marketId,
        outcomeIndex: input.outcomeIndex,
        side: input.side,
        type: input.type,
        price: "0",
        quantity: quantity.toFixed(DECIMAL_PLACES),
        remainingQty: "0",
        status: "REJECTED",
        createdAt: Date.now(),
        userId: input.userId,
        agentId: input.agentId,
        crePayload: input.crePayload ?? null,
      };
      return { order: rejected, trades: [], orderBookSnapshot: emptySnapshot };
    }

    const now = Date.now();
    const priceStr = priceVal.toFixed(DECIMAL_PLACES);
    const order: EngineOrder = {
      id: input.id,
      marketId: input.marketId,
      outcomeIndex: input.outcomeIndex,
      side: input.side,
      type: input.type,
      price: priceStr,
      quantity: quantity.toFixed(DECIMAL_PLACES),
      remainingQty: quantity.toFixed(DECIMAL_PLACES),
      status: "PENDING",
      createdAt: now,
      userId: input.userId,
      agentId: input.agentId,
      crePayload: input.crePayload ?? null,
    };

    const trades: ExecutedTrade[] = [];

    // Match: for LIMIT, BID crosses when ask <= order price; ASK when bid >= order price. MARKET/IOC cross any.
    for (;;) {
      const best = this.getBestOpposite(order.side);
      if (best === null) break;
      if (order.type === "LIMIT") {
        if (order.side === "BID" && new DecimalCtor(best.priceStr).gt(order.price)) break;
        if (order.side === "ASK" && new DecimalCtor(best.priceStr).lt(order.price)) break;
      }
      if (new DecimalCtor(order.remainingQty).lte(0)) break;

      const trade = this.matchOne(order, best.order, best.priceStr, now);
      trades.push(trade);
    }

    if (new DecimalCtor(order.remainingQty).gt(0)) {
      if (order.type === "LIMIT") {
        order.status = new DecimalCtor(order.quantity).minus(order.remainingQty).gt(0) ? "PARTIALLY_FILLED" : "LIVE";
        this.addToBook(order);
      } else {
        order.status = "CANCELLED";
        if (order.type === "MARKET" && trades.length === 0) order.status = "REJECTED";
      }
    } else {
      order.status = "FILLED";
    }

    const orderBookSnapshot = this.getSnapshot();
    return { order, trades, orderBookSnapshot };
  }

  getSnapshot(): OrderBookSnapshot {
    const bids: OrderBookLevel[] = [];
    for (const p of this.bidPrices) {
      const list = this.bids.get(p);
      if (!list || list.length === 0) continue;
      const total = list.reduce((acc, o) => acc.plus(o.remainingQty), new DecimalCtor(0));
      bids.push({ price: p, quantity: total.toFixed(DECIMAL_PLACES), orderCount: list.length });
    }
    const asks: OrderBookLevel[] = [];
    for (const p of this.askPrices) {
      const list = this.asks.get(p);
      if (!list || list.length === 0) continue;
      const total = list.reduce((acc, o) => acc.plus(o.remainingQty), new DecimalCtor(0));
      asks.push({ price: p, quantity: total.toFixed(DECIMAL_PLACES), orderCount: list.length });
    }
    return {
      marketId: this.marketId,
      outcomeIndex: this.outcomeIndex,
      bids,
      asks,
      timestamp: Date.now(),
    };
  }
}

/** Registry of order books by marketId:outcomeIndex. One book per listed option. */
const books = new Map<string, OrderBook>();

function bookKey(marketId: string, outcomeIndex: number): string {
  return `${marketId}:${outcomeIndex}`;
}

/**
 * Get or create the order book for one (market, outcome). Caller must ensure processOrder
 * for this key is only invoked from the single-threaded queue for that key.
 */
export function getOrderBook(marketId: string, outcomeIndex: number): OrderBook {
  const key = bookKey(marketId, outcomeIndex);
  let book = books.get(key);
  if (book === undefined) {
    book = new OrderBook(marketId, outcomeIndex);
    books.set(key, book);
  }
  return book;
}
