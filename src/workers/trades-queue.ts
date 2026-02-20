import { Queue, Worker, type Job } from "bullmq";
import { config } from "../config/index.js";
import type { ExecutedTrade } from "../types/order-book.js";

export const TRADES_QUEUE_NAME = "matching-engine-trades";

export interface TradesJobPayload {
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
 * Enqueue executed trades for background persistence. Do not block the matching engine.
 */
export async function enqueueTradesForPersistence(trades: ExecutedTrade[]): Promise<void> {
  if (trades.length === 0) return;
  const queue = await getTradesQueue();
  await queue.add("persist", { trades }, { removeOnComplete: { count: 1000 } });
}
