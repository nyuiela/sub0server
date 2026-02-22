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

export type MarketPricesQueryInput = z.infer<typeof marketPricesQuerySchema>;
export type MarketQuoteQueryInput = z.infer<typeof marketQuoteQuerySchema>;
