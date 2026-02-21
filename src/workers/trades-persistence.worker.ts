/**
 * Background worker: batch-insert executed trades from the matching engine into PostgreSQL.
 * Consumes jobs from the trades queue; each job contains one or more trades from processOrder.
 * Does not write synchronously from the matching path; the engine only enqueues here.
 * After persisting, increments Market.volume per market and publishes MARKET_UPDATES for frontends.
 */

import { Worker, type Job } from "bullmq";
import { config } from "../config/index.js";
import { REDIS_CHANNELS } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { getRedisPublisher } from "../lib/redis.js";
import type { ExecutedTrade, EngineOrder } from "../types/order-book.js";
import { TRADES_QUEUE_NAME, type TradesJobPayload } from "./trades-queue.js";

function volumeDeltaByMarket(trades: ExecutedTrade[]): Map<string, number> {
  const byMarket = new Map<string, number>();
  for (const t of trades) {
    const delta = Number(t.quantity) * Number(t.price);
    byMarket.set(t.marketId, (byMarket.get(t.marketId) ?? 0) + delta);
  }
  return byMarket;
}

async function persistTrades(job: Job<TradesJobPayload>): Promise<void> {
  const { order, trades } = job.data;
  if (trades.length === 0 && !order) return;

  const prisma = getPrismaClient();
  const now = new Date();

  if (order) {
    await prisma.order.upsert({
      where: { id: order.id },
      create: {
        id: order.id,
        marketId: order.marketId,
        side: order.side,
        amount: order.quantity,
        price: order.price,
        status: order.status,
        createdAt: new Date(order.createdAt),
        updatedAt: now,
      },
      update: {
        amount: order.quantity,
        status: order.status,
        updatedAt: now,
      },
    });
  }

  if (trades.length === 0) return;

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

  const volumeDeltas = volumeDeltaByMarket(trades);
  const marketIds = [...volumeDeltas.keys()];
  for (const marketId of marketIds) {
    const delta = volumeDeltas.get(marketId) ?? 0;
    if (delta <= 0) continue;
    await prisma.$executeRaw`
      UPDATE "Market" SET volume = volume + ${delta} WHERE id = ${marketId}
    `;
  }

  if (marketIds.length > 0) {
    const updated = await prisma.market.findMany({
      where: { id: { in: marketIds } },
      select: { id: true, volume: true },
    });
    const redis = await getRedisPublisher();
    for (const m of updated) {
      await redis.publish(
        REDIS_CHANNELS.MARKET_UPDATES,
        JSON.stringify({
          marketId: m.id,
          reason: "stats",
          volume: m.volume.toString(),
        })
      );
    }
  }
}

async function main(): Promise<void> {
  const worker = new Worker<TradesJobPayload>(
    TRADES_QUEUE_NAME,
    async (job) => persistTrades(job),
    { connection: { url: config.redisUrl }, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    const { order, trades } = job.data;
    const parts = [];
    if (order) parts.push("order");
    if (trades.length > 0) parts.push(`${trades.length} trades`);
    if (parts.length > 0) console.log(`Persistence (${parts.join(", ")}): job ${job.id}`);
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
