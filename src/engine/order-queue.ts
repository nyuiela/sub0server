/**
 * Order Queue: Sequential processor per market for the matching engine.
 *
 * RACE CONDITION PREVENTION (critical for high-frequency agent bursts):
 * - Each marketId has exactly one queue and one consumer. Orders for Market A
 *   are appended to marketA's queue. A single async loop processes that queue
 *   one order at a time: it waits for processOrder() to complete before
 *   starting the next. Thus, for a given market, no two processOrder() calls
 *   run concurrently. The matching engine's in-memory book is only mutated
 *   inside that single-threaded sequence, so no locks or mutexes are needed.
 * - Orders for different markets (Market B, C) are processed in parallel;
 *   each market's queue is independent. Only same-market orders are serialized.
 */

import { getOrderBook } from "./matching-engine.js";
import { getRedisPublisher } from "../lib/redis.js";
import { REDIS_CHANNELS } from "../config/index.js";
import { enqueueOrderAndTradesForPersistence } from "../workers/trades-queue.js";
import type { OrderInput, ExecutedTrade, OrderBookSnapshot } from "../types/order-book.js";

/** Payload published to Redis for ORDER_BOOK_UPDATE. */
export interface OrderBookUpdateMessage {
  marketId: string;
  outcomeIndex: number;
  snapshot: OrderBookSnapshot;
}

/** Payload published to Redis for TRADE_EXECUTED (per trade). */
export interface TradeExecutedMessage {
  trade: ExecutedTrade;
}

/** Queued order plus resolve/reject for the submitter. */
interface QueuedOrder {
  input: OrderInput;
  resolve: (result: { trades: ExecutedTrade[]; snapshot: OrderBookSnapshot }) => void;
  reject: (err: Error) => void;
}

/** Per-market queue: pending orders and whether the consumer is running. */
interface MarketQueue {
  pending: QueuedOrder[];
  processing: boolean;
}

const queues = new Map<string, MarketQueue>();

function queueKey(marketId: string, outcomeIndex: number): string {
  return `${marketId}:${outcomeIndex}`;
}

function getOrCreateQueue(marketId: string, outcomeIndex: number): MarketQueue {
  const key = queueKey(marketId, outcomeIndex);
  let q = queues.get(key);
  if (q === undefined) {
    q = { pending: [], processing: false };
    queues.set(key, q);
  }
  return q;
}

/**
 * Process one order: run matching engine, publish events, return trades.
 * Called only from drainQueue for this (market, outcome) (single-threaded per book).
 */
async function processOne(marketId: string, outcomeIndex: number, input: OrderInput): Promise<{
  trades: ExecutedTrade[];
  snapshot: OrderBookSnapshot;
}> {
  const book = getOrderBook(marketId, outcomeIndex);
  const result = book.processOrder(input);
  const redis = await getRedisPublisher();

  await redis.publish(
    REDIS_CHANNELS.ORDER_BOOK_UPDATE,
    JSON.stringify({
      marketId,
      outcomeIndex,
      snapshot: result.orderBookSnapshot,
    } as OrderBookUpdateMessage)
  );

  await redis.publish(
    REDIS_CHANNELS.MARKET_UPDATES,
    JSON.stringify({ marketId, reason: "orderbook" })
  );

  for (const trade of result.trades) {
    await redis.publish(
      REDIS_CHANNELS.TRADES,
      JSON.stringify({ trade } as TradeExecutedMessage)
    );
  }

  enqueueOrderAndTradesForPersistence(result.order, result.trades).catch((err) =>
    console.error("Enqueue order and trades for persistence failed:", err)
  );

  return { trades: result.trades, snapshot: result.orderBookSnapshot };
}

/**
 * Drain this (market, outcome)'s queue: take the next order, process it, then recurse
 * if more are pending. Only one drain runs per book at a time (processing flag).
 */
async function drainQueue(marketId: string, outcomeIndex: number): Promise<void> {
  const q = getOrCreateQueue(marketId, outcomeIndex);
  if (q.processing || q.pending.length === 0) return;

  q.processing = true;
  const next = q.pending.shift()!;

  try {
    const { trades, snapshot } = await processOne(marketId, outcomeIndex, next.input);
    next.resolve({ trades, snapshot });
  } catch (err) {
    next.reject(err instanceof Error ? err : new Error(String(err)));
  } finally {
    q.processing = false;
    if (q.pending.length > 0) {
      setImmediate(() => drainQueue(marketId, outcomeIndex));
    }
  }
}

/**
 * Submit an order for one outcome of a market. It is appended to that outcome's queue and
 * processed in FIFO order. Returns a promise that resolves when this order has been processed.
 */
export function submitOrder(input: OrderInput): Promise<{
  trades: ExecutedTrade[];
  snapshot: OrderBookSnapshot;
}> {
  const { marketId, outcomeIndex } = input;
  const q = getOrCreateQueue(marketId, outcomeIndex);

  return new Promise((resolve, reject) => {
    q.pending.push({ input, resolve, reject });
    setImmediate(() => drainQueue(marketId, outcomeIndex));
  });
}
