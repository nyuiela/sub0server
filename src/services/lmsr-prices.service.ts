/**
 * LMSR-based prices for markets. Builds outcome quantities (q) from Position records
 * and market liquidity (b), then exposes instantaneous prices and buy/sell quotes.
 */

import Decimal from "decimal.js";
import { getPrismaClient } from "../lib/prisma.js";
import {
  getAllPrices,
  getQuoteForBuy,
  getQuoteForSell,
} from "../engine/lmsr-engine.js";
import type { OutcomeQuantities } from "../types/lmsr.js";

const DEFAULT_LIQUIDITY = "100";

export interface LmsrMarketState {
  marketId: string;
  outcomes: string[];
  /** Outcome quantities (LMSR q). Net LONG minus SHORT per outcome from positions. */
  quantities: OutcomeQuantities;
  /** Liquidity parameter b (from Market.liquidity or default). */
  liquidityParameter: string;
}

export interface OutcomePrice {
  outcomeIndex: number;
  label: string;
  /** Instantaneous (marginal) price in [0,1]. */
  instantPrice: string;
  /** Quote for buying this option at the given quantity. */
  buyQuote: { quantity: string; instantPrice: string; tradeCost: string };
  /** Quote for selling this option at the given quantity. */
  sellQuote: { quantity: string; instantPrice: string; tradeCost: string };
}

export interface MarketPricesResponse {
  marketId: string;
  outcomes: string[];
  liquidityParameter: string;
  quantities: string[];
  /** Instantaneous price per outcome (sum to 1). */
  prices: string[];
  /** Per-outcome buy/sell quotes at the requested quantity. */
  options: OutcomePrice[];
}

export interface SingleQuoteResponse {
  marketId: string;
  outcomeIndex: number;
  side: "BUY" | "SELL";
  quantity: string;
  instantPrice: string;
  tradeCost: string;
}

/**
 * Load market and aggregate positions to build LMSR state (q, b).
 * q[i] = sum(LONG collateralLocked for outcome i) - sum(SHORT collateralLocked for outcome i).
 */
export async function getLmsrStateForMarket(marketId: string): Promise<LmsrMarketState | null> {
  const prisma = getPrismaClient();
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: { id: true, outcomes: true, liquidity: true },
  });
  if (!market) return null;

  const outcomes = market.outcomes as unknown[];
  const n = Array.isArray(outcomes) ? outcomes.length : 0;
  if (n === 0) return null;

  const positions = await prisma.position.findMany({
    where: { marketId },
    select: { outcomeIndex: true, side: true, collateralLocked: true },
  });

  const qNum: Decimal[] = Array.from({ length: n }, () => new Decimal(0));
  for (const p of positions) {
    if (p.outcomeIndex < 0 || p.outcomeIndex >= n) continue;
    const amt = new Decimal(p.collateralLocked.toString());
    if (p.side === "LONG") {
      qNum[p.outcomeIndex] = qNum[p.outcomeIndex].plus(amt);
    } else {
      qNum[p.outcomeIndex] = qNum[p.outcomeIndex].minus(amt);
    }
  }
  const q: OutcomeQuantities = qNum.map((d) => d.toFixed(18));

  const b =
    market.liquidity != null && String(market.liquidity).trim() !== ""
      ? String(market.liquidity)
      : DEFAULT_LIQUIDITY;

  const labels = Array.isArray(outcomes)
    ? outcomes.map((o) => (typeof o === "string" ? o : typeof o === "object" && o != null && "label" in o ? String((o as { label: string }).label) : String(o)))
    : Array.from({ length: n }, (_, i) => `Outcome ${i}`);

  return {
    marketId,
    outcomes: labels,
    quantities: q,
    liquidityParameter: b,
  };
}

/**
 * Get all prices and per-outcome buy/sell quotes for a market.
 * quoteQuantity is the size used for each option's buy/sell quote (default "1").
 */
export async function getMarketPrices(
  marketId: string,
  quoteQuantity: string = "1"
): Promise<MarketPricesResponse | null> {
  const state = await getLmsrStateForMarket(marketId);
  if (!state) return null;

  const { quantities, liquidityParameter: b, outcomes } = state;
  const prices = getAllPrices(quantities, b);

  const options: OutcomePrice[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    let buyQuote: { instantPrice: string; tradeCost: string };
    let sellQuote: { instantPrice: string; tradeCost: string };
    try {
      const buy = getQuoteForBuy(quantities, b, i, quoteQuantity);
      buyQuote = { instantPrice: buy.instantPrice, tradeCost: buy.tradeCost };
    } catch {
      buyQuote = { instantPrice: prices[i] ?? "0", tradeCost: "0" };
    }
    try {
      const sell = getQuoteForSell(quantities, b, i, quoteQuantity);
      sellQuote = { instantPrice: sell.instantPrice, tradeCost: sell.tradeCost };
    } catch {
      sellQuote = { instantPrice: prices[i] ?? "0", tradeCost: "0" };
    }
    options.push({
      outcomeIndex: i,
      label: outcomes[i] ?? `Outcome ${i}`,
      instantPrice: prices[i] ?? "0",
      buyQuote: { quantity: quoteQuantity, ...buyQuote },
      sellQuote: { quantity: quoteQuantity, ...sellQuote },
    });
  }

  return {
    marketId,
    outcomes,
    liquidityParameter: b,
    quantities,
    prices,
    options,
  };
}

/**
 * Get a single buy or sell quote for one outcome.
 */
export async function getMarketQuote(
  marketId: string,
  outcomeIndex: number,
  side: "BUY" | "SELL",
  quantity: string
): Promise<SingleQuoteResponse | null> {
  const state = await getLmsrStateForMarket(marketId);
  if (!state) return null;
  if (outcomeIndex < 0 || outcomeIndex >= state.quantities.length) return null;

  const { quantities, liquidityParameter: b } = state;
  try {
    const quote =
      side === "BUY"
        ? getQuoteForBuy(quantities, b, outcomeIndex, quantity)
        : getQuoteForSell(quantities, b, outcomeIndex, quantity);
    return {
      marketId,
      outcomeIndex,
      side,
      quantity,
      instantPrice: quote.instantPrice,
      tradeCost: quote.tradeCost,
    };
  } catch {
    return null;
  }
}
