import { Queue } from "bullmq";
import { config } from "../config/index.js";
import type { ExecutedTrade, EngineOrder } from "../types/order-book.js";

export const TRADES_QUEUE_NAME = "matching-engine-trades";

export interface TradesJobPayload {
  order?: EngineOrder;
  trades: ExecutedTrade[];
}

let tradesQueue: Queue<TradesJobPayload> | null = null;

export async function getTradesQueue(): Promise<Queue<TradesJobPayload>> {
  if (tradesQueue === null) {
    tradesQueue = new Queue<TradesJobPayload>(TRADES_QUEUE_NAME, {
      connection: { url: config.redisUrl },
    });
  }
  return tradesQueue;
}

/**
 * Enqueue order and executed trades for background persistence. Do not block the matching engine.
 * Every processed order is persisted; trades are persisted when present.
 */
export async function enqueueOrderAndTradesForPersistence(
  order: EngineOrder,
  trades: ExecutedTrade[]
): Promise<void> {
  const queue = await getTradesQueue();
  await queue.add("persist", { order, trades }, { removeOnComplete: { count: 1000 } });
}
