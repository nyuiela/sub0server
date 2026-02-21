/**
 * LMSR (Logarithmic Market Scoring Rule) types.
 * q[i] = outstanding shares for outcome i, b = liquidity parameter.
 */

/** Outcome quantities (shares) per outcome. Length n = number of outcomes. */
export type OutcomeQuantities = string[];

/** Change in shares per outcome (positive = buy that outcome). */
export type TradeVector = string[];

/** Liquidity parameter. Worst-case market maker loss is b * ln(n). */
export type LiquidityParam = string;

export interface LMSRQuote {
  marketId: string;
  outcomeIndex: number;
  side: "BUY" | "SELL";
  quantity: string;
  /** Instantaneous price (marginal price) at which the quote is valid. */
  instantPrice: string;
  /** Total cost in USDC (positive = user pays, for BUY). */
  tradeCost: string;
  /** Outcome quantities after the trade (for verification). */
  qAfter: OutcomeQuantities;
  nonce: string;
  deadline: number;
}
