/**
 * Background worker: batch-insert executed trades from the matching engine into PostgreSQL.
 * Consumes jobs from the trades queue; each job contains one or more trades from processOrder.
 * Does not write synchronously from the matching path; the engine only enqueues here.
 */

import { Worker, type Job } from "bullmq";
import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import type { ExecutedTrade } from "../types/order-book.js";
import { TRADES_QUEUE_NAME, type TradesJobPayload } from "./trades-queue.js";

async function persistTrades(job: Job<TradesJobPayload>): Promise<void> {
  const { trades } = job.data;
  if (trades.length === 0) return;

  const prisma = getPrismaClient();

  await prisma.trade.createMany({
    data: trades.map((t: ExecutedTrade) => ({
      id: t.id,
      marketId: t.marketId,
      userId: t.userId ?? undefined,
      agentId: t.agentId ?? undefined,
      side: t.side,
      amount: t.quantity,
      price: t.price,
      createdAt: new Date(t.executedAt),
    })),
    skipDuplicates: true,
  });

  // Position updates: Prisma Position requires marketId, userId/agentId, address, tokenAddress,
  // outcomeIndex, side (LONG/SHORT), avgPrice, collateralLocked. ExecutedTrade does not carry
  // address/tokenAddress/outcomeIndex. Aggregate position updates can be added here when
  // those fields are available (e.g. from order context or market config).
}

async function main(): Promise<void> {
  const worker = new Worker<TradesJobPayload>(
    TRADES_QUEUE_NAME,
    async (job) => persistTrades(job),
    { connection: { url: config.redisUrl }, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    const n = job.data.trades.length;
    if (n > 0) console.log(`Trades persistence: ${n} trades for job ${job.id}`);
  });
  worker.on("failed", (job, err) => console.error(`Trades job ${job?.id} failed:`, err));

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
