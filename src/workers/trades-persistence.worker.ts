/**
 * Background worker: batch-insert executed trades from the matching engine into PostgreSQL.
 * Consumes jobs from the trades queue; each job contains one or more trades from processOrder.
 * Applies each fill to positions (buy = LONG +qty, sell = LONG -qty or SHORT +qty).
 * After persisting, increments Market.volume and publishes MARKET_UPDATES.
 */

import dotenv from "dotenv";
dotenv.config();

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, type Job } from "bullmq";
import { Decimal } from "decimal.js";
import { config, REDIS_CHANNELS } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { getRedisPublisher } from "../lib/redis.js";
import type { PrismaClient } from "@prisma/client";
import type { ExecutedTrade, EngineOrder } from "../types/order-book.js";
import type { CreOrderPayload } from "../types/cre-order.js";
import { TRADES_QUEUE_NAME, type TradesJobPayload } from "./trades-queue.js";
import { executeUserTradeOnCre, executeAgentTradeOnCre } from "../services/cre-execute-trade.service.js";

async function resolveAddress(
  prisma: PrismaClient,
  userId: string | null | undefined,
  agentId: string | null | undefined
): Promise<string | null> {
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { address: true } });
    return user?.address ?? null;
  }
  if (agentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { walletAddress: true, owner: { select: { address: true } } },
    });
    const wallet = agent?.walletAddress?.trim();
    if (wallet) return wallet;
    return agent?.owner?.address ?? null;
  }
  return null;
}

/**
 * For each maker order referenced in trades, set status to PARTIALLY_FILLED or FILLED
 * based on total filled quantity in this job vs order amount.
 */
async function updateMakerOrderStatuses(
  prisma: PrismaClient,
  trades: ExecutedTrade[]
): Promise<void> {
  const filledByMakerId = new Map<string, Decimal>();
  for (const t of trades) {
    const qty = new Decimal(t.quantity);
    const prev = filledByMakerId.get(t.makerOrderId) ?? new Decimal(0);
    filledByMakerId.set(t.makerOrderId, prev.plus(qty));
  }
  for (const [makerOrderId, filledQty] of filledByMakerId) {
    const order = await prisma.order.findUnique({
      where: { id: makerOrderId },
      select: { id: true, amount: true, status: true },
    });
    if (!order) continue;
    const orderAmount = new Decimal(order.amount.toString());
    const status =
      filledQty.gte(orderAmount) ? "FILLED" : "PARTIALLY_FILLED";
    if (order.status !== "FILLED") {
      await prisma.order.update({
        where: { id: makerOrderId },
        data: { status, updatedAt: new Date() },
      });
    }
  }
}

/**
 * Apply each trade to buyer and seller positions for that outcome.
 * Buyer (BID taker or ASK maker): LONG position +quantity.
 * Seller (ASK maker or BID taker): LONG -quantity or SHORT +quantity.
 */
async function applyTradesToPositions(prisma: PrismaClient, trades: ExecutedTrade[]): Promise<void> {
  for (const t of trades) {
    const qty = new Decimal(t.quantity);
    const price = new Decimal(t.price);
    const buyerUserId = t.side === "BID" ? t.userId : t.makerUserId;
    const buyerAgentId = t.side === "BID" ? t.agentId : t.makerAgentId;
    const sellerUserId = t.side === "ASK" ? t.userId : t.makerUserId;
    const sellerAgentId = t.side === "ASK" ? t.agentId : t.makerAgentId;
    const buyerAddress = await resolveAddress(prisma, buyerUserId, buyerAgentId);
    const sellerAddress =
      sellerUserId ?? sellerAgentId
        ? await resolveAddress(prisma, sellerUserId, sellerAgentId)
        : (t.makerOrderId?.startsWith("platform-") ? config.platformLiquidityAddress ?? null : null);

    const market = await prisma.market.findUnique({
      where: { id: t.marketId },
      select: { collateralToken: true, outcomePositionIds: true },
    });
    const collateralToken = market?.collateralToken ?? "";
    const outcomePositionIds = market?.outcomePositionIds as string[] | null;
    const contractPositionId =
      Array.isArray(outcomePositionIds) && t.outcomeIndex < outcomePositionIds.length
        ? outcomePositionIds[t.outcomeIndex] ?? null
        : null;

    if (buyerAddress) {
      const existing = await prisma.position.findFirst({
        where: {
          marketId: t.marketId,
          outcomeIndex: t.outcomeIndex,
          address: buyerAddress,
          side: "LONG",
          status: "OPEN",
        },
      });
      const newLocked = existing
        ? new Decimal(existing.collateralLocked.toString()).plus(qty)
        : qty;
      const newAvg =
        existing && new Decimal(existing.collateralLocked.toString()).gt(0)
          ? new Decimal(existing.avgPrice.toString())
              .times(existing.collateralLocked.toString())
              .plus(price.times(t.quantity))
              .div(newLocked)
          : price;
      if (existing) {
        await prisma.position.update({
          where: { id: existing.id },
          data: {
            avgPrice: newAvg.toFixed(18),
            collateralLocked: newLocked.toFixed(18),
            updatedAt: new Date(),
          },
        });
      } else {
        await prisma.position.create({
          data: {
            marketId: t.marketId,
            outcomeIndex: t.outcomeIndex,
            address: buyerAddress,
            userId: buyerUserId ?? undefined,
            agentId: buyerAgentId ?? undefined,
            tokenAddress: collateralToken,
            contractPositionId,
            side: "LONG",
            status: "OPEN",
            avgPrice: newAvg.toFixed(18),
            collateralLocked: newLocked.toFixed(18),
            isAmm: false,
          },
        });
      }
    }

    if (sellerAddress) {
      const longPos = await prisma.position.findFirst({
        where: {
          marketId: t.marketId,
          outcomeIndex: t.outcomeIndex,
          address: sellerAddress,
          side: "LONG",
          status: "OPEN",
        },
      });
      if (longPos) {
        const current = new Decimal(longPos.collateralLocked.toString());
        const after = current.minus(qty);
        if (after.lte(0)) {
          await prisma.position.update({
            where: { id: longPos.id },
            data: {
              collateralLocked: "0",
              status: "CLOSED",
              updatedAt: new Date(),
            },
          });
          if (after.lt(0)) {
            await prisma.position.create({
              data: {
                marketId: t.marketId,
                outcomeIndex: t.outcomeIndex,
                address: sellerAddress,
                userId: sellerUserId ?? undefined,
                agentId: sellerAgentId ?? undefined,
                tokenAddress: collateralToken,
                contractPositionId,
                side: "SHORT",
                status: "OPEN",
                avgPrice: price.toFixed(18),
                collateralLocked: after.abs().toFixed(18),
                isAmm: false,
              },
            });
          }
        } else {
          await prisma.position.update({
            where: { id: longPos.id },
            data: {
              collateralLocked: after.toFixed(18),
              updatedAt: new Date(),
            },
          });
        }
      } else {
        await prisma.position.create({
          data: {
            marketId: t.marketId,
            outcomeIndex: t.outcomeIndex,
            address: sellerAddress,
            userId: sellerUserId ?? undefined,
            agentId: sellerAgentId ?? undefined,
            tokenAddress: collateralToken,
            contractPositionId,
            side: "SHORT",
            status: "OPEN",
            avgPrice: price.toFixed(18),
            collateralLocked: qty.toFixed(18),
            isAmm: false,
          },
        });
      }
    }
  }
}

function volumeDeltaByMarket(trades: ExecutedTrade[]): Map<string, number> {
  const byMarket = new Map<string, number>();
  for (const t of trades) {
    const delta = Number(t.quantity) * Number(t.price);
    byMarket.set(t.marketId, (byMarket.get(t.marketId) ?? 0) + delta);
  }
  return byMarket;
}

/** USDC 6 decimals; tradeCostUsdc for a fill = quantity * price. */
function tradeCostUsdcForFill(quantity: string, price: string): string {
  return new Decimal(quantity).times(price).toDecimalPlaces(6).toFixed();
}

/**
 * Execute on CRE: user order once when FILLED (with stored crePayload); agent orders per fill.
 */
async function executeCreTrades(
  prisma: PrismaClient,
  order: EngineOrder | undefined,
  trades: ExecutedTrade[]
): Promise<void> {
  if (order?.status === "FILLED" && order.crePayload != null) {
    const payload = order.crePayload as CreOrderPayload;
    if (payload.userSignature) {
      const result = await executeUserTradeOnCre(payload);
      if (!result.ok) {
        console.warn(`CRE user trade failed (order ${order.id}):`, result.error);
      }
    }
  }

  const deadline = String(Math.floor(Date.now() / 1000) + 300);
  const nonce = "0";

  for (const t of trades) {
    const market = await prisma.market.findUnique({
      where: { id: t.marketId },
      select: { questionId: true },
    });
    const questionId = market?.questionId?.trim();
    if (!questionId) continue;

    const tradeCostUsdc = tradeCostUsdcForFill(t.quantity, t.price);
    const buy = t.side === "BID";

    if (t.agentId) {
      const result = await executeAgentTradeOnCre({
        agentId: t.agentId,
        questionId,
        outcomeIndex: t.outcomeIndex,
        buy,
        quantity: t.quantity,
        tradeCostUsdc,
        nonce,
        deadline,
      });
      if (!result.ok) {
        console.warn(`CRE agent trade failed (taker ${t.agentId}, trade ${t.id}):`, result.error);
      }
    }

    if (t.makerAgentId) {
      const result = await executeAgentTradeOnCre({
        agentId: t.makerAgentId,
        questionId,
        outcomeIndex: t.outcomeIndex,
        buy: !buy,
        quantity: t.quantity,
        tradeCostUsdc,
        nonce,
        deadline,
      });
      if (!result.ok) {
        console.warn(`CRE agent trade failed (maker ${t.makerAgentId}, trade ${t.id}):`, result.error);
      }
    }
  }
}

async function persistTrades(job: Job<TradesJobPayload>): Promise<void> {
  const { order, trades } = job.data;
  if (trades.length === 0 && !order) return;

  const prisma = getPrismaClient();
  const marketId = order?.marketId ?? trades[0]?.marketId;
  if (marketId) {
    const market = await prisma.market.findUnique({ where: { id: marketId }, select: { id: true } });
    if (!market) {
      console.warn(`Trades job ${job.id}: market ${marketId} not found (deleted?), skipping persist`);
      return;
    }
  }

  const now = new Date();

  if (order) {
    await prisma.order.upsert({
      where: { id: order.id },
      create: {
        id: order.id,
        marketId: order.marketId,
        outcomeIndex: order.outcomeIndex,
        side: order.side,
        type: order.type,
        amount: order.quantity,
        price: order.price,
        status: order.status,
        createdAt: new Date(order.createdAt),
        updatedAt: now,
        userId: order.userId ?? undefined,
        agentId: order.agentId ?? undefined,
        crePayload: order.crePayload != null ? (order.crePayload as object) : undefined,
      },
      update: {
        type: order.type,
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
      outcomeIndex: t.outcomeIndex,
      userId: t.userId ?? undefined,
      agentId: t.agentId ?? undefined,
      side: t.side,
      amount: t.quantity,
      price: t.price,
      createdAt: new Date(t.executedAt),
    })),
    skipDuplicates: true,
  });

  await updateMakerOrderStatuses(prisma, trades);
  await applyTradesToPositions(prisma, trades);

  await executeCreTrades(prisma, order, trades);

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

/**
 * Create and start the trades persistence worker. Use from server (in-process) or run this file standalone.
 * Returns the Worker instance so the caller can close it on shutdown.
 */
export async function startTradesPersistenceWorker(): Promise<Worker<TradesJobPayload>> {
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

  return worker;
}

async function main(): Promise<void> {
  const worker = await startTradesPersistenceWorker();
  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const __filename = fileURLToPath(import.meta.url);
const entryPath = resolve(process.argv[1] ?? "");
if (entryPath === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
