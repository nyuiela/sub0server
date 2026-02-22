/**
 * Aggregated stats per market for list and detail endpoints.
 * Uses raw queries to avoid N+1 and to compute totalVolume (sum of amount*price).
 */

import { Prisma } from "@prisma/client";
import { getPrismaClient } from "../lib/prisma.js";
import { getOrderBook } from "../engine/matching-engine.js";
import type { OrderBookSnapshot } from "../types/order-book.js";

export interface MarketStatsRow {
  marketId: string;
  totalVolume: string;
  lastTradeAt: Date | null;
  totalTrades: number;
  uniqueStakers: number;
  agentsEngaging: number;
  newsCount: number;
}

export interface OrderBookStats {
  activeOrderCount: number;
  bidLiquidity: string;
  askLiquidity: string;
  snapshot: OrderBookSnapshot | null;
}

/**
 * Get trade-based and position-based aggregates for the given market IDs.
 * Returns a map marketId -> stats. Missing markets get default stats.
 */
export async function getMarketStatsBatch(marketIds: string[]): Promise<Map<string, MarketStatsRow>> {
  const map = new Map<string, MarketStatsRow>();
  if (marketIds.length === 0) return map;

  const prisma = getPrismaClient();

  const [tradeRows, positionStakers, positionAgents, newsCounts] = await Promise.all([
    prisma.$queryRaw<{ market_id: string; total_volume: unknown; last_trade_at: Date | null; total_trades: bigint }[]>`
      SELECT t."marketId" as market_id,
             COALESCE(SUM(t.amount * t.price), 0)::decimal as total_volume,
             MAX(t."createdAt") as last_trade_at,
             COUNT(*)::bigint as total_trades
      FROM "Trade" t
      WHERE t."marketId" IN (${Prisma.join(marketIds)})
      GROUP BY t."marketId"
    `,
    prisma.$queryRaw<{ market_id: string; unique_stakers: bigint }[]>`
      SELECT p."marketId" as market_id, COUNT(DISTINCT p.address)::bigint as unique_stakers
      FROM "Position" p
      WHERE p."marketId" IN (${Prisma.join(marketIds)})
      GROUP BY p."marketId"
    `,
    prisma.$queryRaw<{ market_id: string; agents_engaging: bigint }[]>`
      SELECT p."marketId" as market_id, COUNT(DISTINCT p."agentId")::bigint as agents_engaging
      FROM "Position" p
      WHERE p."marketId" IN (${Prisma.join(marketIds)}) AND p."agentId" IS NOT NULL
      GROUP BY p."marketId"
    `,
    prisma.news.groupBy({
      by: ["marketId"],
      where: { marketId: { in: marketIds } },
      _count: { id: true },
    }),
  ]);

  for (const id of marketIds) {
    const t = tradeRows.find((r) => r.market_id === id);
    const s = positionStakers.find((r) => r.market_id === id);
    const a = positionAgents.find((r) => r.market_id === id);
    const n = newsCounts.find((r) => r.marketId === id);
    map.set(id, {
      marketId: id,
      totalVolume: t?.total_volume != null ? String(t.total_volume) : "0",
      lastTradeAt: t?.last_trade_at ?? null,
      totalTrades: t?.total_trades != null ? Number(t.total_trades) : 0,
      uniqueStakers: s?.unique_stakers != null ? Number(s.unique_stakers) : 0,
      agentsEngaging: a?.agents_engaging != null ? Number(a.agents_engaging) : 0,
      newsCount: n?._count?.id ?? 0,
    });
  }
  return map;
}

/**
 * Get contract position IDs (from smart contract) for a market.
 */
export async function getMarketPositionIds(marketId: string): Promise<string[]> {
  const prisma = getPrismaClient();
  const positions = await prisma.position.findMany({
    where: { marketId },
    select: { contractPositionId: true },
  });
  return positions.map((p) => p.contractPositionId).filter((id): id is string => id != null && id !== "");
}

/**
 * Get order book stats for one outcome of a market from the in-memory matching engine.
 * outcomeIndex defaults to 0 (first listed option, e.g. Yes). Active order count and liquidity.
 */
export function getOrderBookStatsForMarket(marketId: string, outcomeIndex = 0): OrderBookStats {
  const book = getOrderBook(marketId, outcomeIndex);
  const snapshot = book.getSnapshot();
  let bidLiquidity = "0";
  let askLiquidity = "0";
  let activeOrderCount = 0;
  for (const level of snapshot.bids) {
    activeOrderCount += level.orderCount ?? 0;
    bidLiquidity = String(Number(bidLiquidity) + Number(level.price) * Number(level.quantity));
  }
  for (const level of snapshot.asks) {
    activeOrderCount += level.orderCount ?? 0;
    askLiquidity = String(Number(askLiquidity) + Number(level.price) * Number(level.quantity));
  }
  return {
    activeOrderCount,
    bidLiquidity,
    askLiquidity,
    snapshot,
  };
}
