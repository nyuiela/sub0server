import { z } from "zod";

export const marketPricesQuerySchema = z.object({
  /** Quantity to use for per-option buy/sell quotes (default 1). */
  quantity: z.coerce.string().optional().default("1"),
});

export const marketQuoteQuerySchema = z.object({
  outcomeIndex: z.coerce.number().int().min(0),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.coerce.string().min(1),
});

export const candlesQuerySchema = z.object({
  /** Per-outcome series (0, 1, ...). Omit for market-level single series. */
  outcomeIndex: z.coerce.number().int().min(0).optional(),
  /** Candle bucket size: 1m, 1h, 1d. */
  resolution: z.enum(["1m", "1h", "1d"]).optional().default("1h"),
  /** Max number of candles to return (default 200). */
  limit: z.coerce.number().int().min(1).max(500).optional().default(200),
  /** Start of range (ISO string). */
  from: z.string().datetime().optional(),
  /** End of range (ISO string). */
  to: z.string().datetime().optional(),
});

export type MarketPricesQueryInput = z.infer<typeof marketPricesQuerySchema>;
export type MarketQuoteQueryInput = z.infer<typeof marketQuoteQuerySchema>;
export type CandlesQueryInput = z.infer<typeof candlesQuerySchema>;
