import type { CreOrderPayload } from "./cre-order.js";

/**
 * Order side: BID (buy) or ASK (sell).
 * Matching: BIDs match against resting ASKs and vice versa.
 */
export type OrderSide = "BID" | "ASK";

/**
 * Order type determines behaviour at submission and when no fill.
 * - LIMIT: Add to book if no (or partial) match; price is required.
 * - MARKET: Execute immediately at best available price(s); no resting quantity.
 * - IOC (Immediate-or-Cancel): Fill what is available now, cancel the rest; never rests.
 */
export type OrderType = "LIMIT" | "MARKET" | "IOC";

/**
 * Lifecycle status of an order in the engine.
 */
export type OrderStatus =
  | "PENDING"
  | "LIVE"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED";

/**
 * In-engine order representation. All monetary and quantity fields are string
 * (decimal.js serialized) to avoid float rounding errors in a high-throughput matching engine.
 */
export interface EngineOrder {
  id: string;
  marketId: string;
  /** Which outcome (option) this order is for; e.g. 0 = Yes, 1 = No. */
  outcomeIndex: number;
  side: OrderSide;
  type: OrderType;
  /** Limit price; required for LIMIT, "0" for MARKET/IOC. */
  price: string;
  /** Original quantity. */
  quantity: string;
  /** Remaining quantity to fill; updated by matching. */
  remainingQty: string;
  status: OrderStatus;
  /** Monotonic timestamp for time-priority within a price level (ms). */
  createdAt: number;
  userId?: string | null;
  agentId?: string | null;
  crePayload?: CreOrderPayload | null;
}

/**
 * Input order as submitted to the matching engine. price may be omitted for MARKET.
 * outcomeIndex identifies which listed option (e.g. Yes=0, No=1) is being bought/sold.
 * crePayload: for user orders, quote params + userSignature so CRE can execute on fill.
 */
export interface OrderInput {
  id: string;
  marketId: string;
  outcomeIndex: number;
  side: OrderSide;
  type: OrderType;
  price?: string | number;
  quantity: string | number;
  userId?: string | null;
  agentId?: string | null;
  crePayload?: CreOrderPayload | null;
}

/**
 * Executed trade produced by the matching engine. One record per fill (taker vs maker).
 * Used for event broadcast and for batch persistence to PostgreSQL.
 */
export interface ExecutedTrade {
  id: string;
  marketId: string;
  /** Which outcome (option) was traded; e.g. 0 = Yes, 1 = No. */
  outcomeIndex: number;
  /** Price at which the trade occurred (maker's price). */
  price: string;
  quantity: string;
  /** Order that was resting in the book (maker). */
  makerOrderId: string;
  /** Order that took liquidity (taker). */
  takerOrderId: string;
  side: "BID" | "ASK";
  /** Taker (buyer/seller who hit the book). */
  userId?: string | null;
  agentId?: string | null;
  /** Maker (resting order); for position updates. */
  makerUserId?: string | null;
  makerAgentId?: string | null;
  executedAt: number;
}

export type { CreOrderPayload } from "./cre-order.js";

/**
 * Single level in the order book snapshot (price + total quantity at that price).
 */
export interface OrderBookLevel {
  price: string;
  quantity: string;
  orderCount?: number;
}

/**
 * Full order book snapshot for one outcome of a market. Used for ORDER_BOOK_UPDATE events
 * and for debugging / REST APIs.
 */
export interface OrderBookSnapshot {
  marketId: string;
  /** Which outcome (option) this book is for; e.g. 0 = Yes, 1 = No. */
  outcomeIndex: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

/**
 * Result of processOrder: updated order state and list of trades executed.
 */
export interface ProcessOrderResult {
  order: EngineOrder;
  trades: ExecutedTrade[];
  /** Snapshot after this order was applied (for broadcast). */
  orderBookSnapshot: OrderBookSnapshot;
}
