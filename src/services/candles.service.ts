/**
 * OHLC candles (price history) for charting. Built from Trade table by time bucket.
 * Supports per-outcome series (outcomeIndex=0,1,...) or market-level (no outcomeIndex).
 */

import { getPrismaClient } from "../lib/prisma.js";

export type CandleResolution = "1m" | "1h" | "1d";

export interface Candle {
  /** Bucket start time in milliseconds (UTC). */
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  /** Notional volume (sum of amount * price) in that bucket. */
  volume: string;
}

const RESOLUTION_MS: Record<CandleResolution, number> = {
  "1m": 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

function bucketTs(ts: Date, resolution: CandleResolution): number {
  const ms = ts.getTime();
  const step = RESOLUTION_MS[resolution];
  return Math.floor(ms / step) * step;
}

/**
 * Get OHLC candles for a market. Optionally filter by outcomeIndex.
 * When outcomeIndex is omitted, returns one series aggregating all outcomes (market-level).
 * When outcomeIndex is provided, returns candles for that outcome only.
 */
export async function getMarketCandles(
  marketId: string,
  resolution: CandleResolution,
  options: {
    outcomeIndex?: number;
    limit?: number;
    from?: Date;
    to?: Date;
  } = {}
): Promise<Candle[]> {
  const { outcomeIndex, limit = 200, from, to } = options;
  const prisma = getPrismaClient();

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: { id: true },
  });
  if (!market) return [];

  const where: { marketId: string; outcomeIndex?: number; createdAt?: object } = {
    marketId,
  };
  if (outcomeIndex !== undefined) where.outcomeIndex = outcomeIndex;
  if (from ?? to) {
    where.createdAt = {};
    if (from) (where.createdAt as Record<string, Date>).gte = from;
    if (to) (where.createdAt as Record<string, Date>).lte = to;
  }

  const trades = await prisma.trade.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      price: true,
      amount: true,
      createdAt: true,
    },
  });

  if (trades.length === 0) return [];

  const buckets = new Map<number, { open: string; high: string; low: string; close: string; volume: number }>();

  for (const t of trades) {
    const ts = t.createdAt;
    const key = bucketTs(ts, resolution);
    const price = Number(t.price);
    const amount = Number(t.amount);
    const notional = price * amount;

    const existing = buckets.get(key);
    if (!existing) {
      const pStr = t.price.toString();
      buckets.set(key, {
        open: pStr,
        high: pStr,
        low: pStr,
        close: pStr,
        volume: notional,
      });
    } else {
      const pStr = t.price.toString();
      const high = Math.max(Number(existing.high), price);
      const low = Math.min(Number(existing.low), price);
      buckets.set(key, {
        open: existing.open,
        high: String(high),
        low: String(low),
        close: pStr,
        volume: existing.volume + notional,
      });
    }
  }

  const candles: Candle[] = [];
  for (const [time, ohlc] of buckets) {
    candles.push({
      time,
      open: ohlc.open,
      high: ohlc.high,
      low: ohlc.low,
      close: ohlc.close,
      volume: String(ohlc.volume),
    });
  }
  candles.sort((a, b) => a.time - b.time);

  const fromIndex = limit >= candles.length ? 0 : candles.length - limit;
  return candles.slice(fromIndex);
}
