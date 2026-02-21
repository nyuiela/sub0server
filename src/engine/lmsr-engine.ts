/**
 * LMSR (Logarithmic Market Scoring Rule) pricing engine.
 * All monetary and quantity values use string decimals (decimal.js) for precision.
 * Formulas:
 *   Cost:    C(q) = b * ln( sum_i exp(q_i / b) )
 *   Price:   p_i(q) = exp(q_i / b) / sum_j exp(q_j / b)
 *   Trade:   cost = C(q_after) - C(q_before)
 * Worst-case market maker loss: b * ln(n).
 */

import Decimal from "decimal.js";
import type { OutcomeQuantities, TradeVector } from "../types/lmsr.js";

const DECIMAL_PLACES = 18;

type D = import("decimal.js").default;
const Ctor = ((Decimal as unknown as { default?: unknown }).default ?? Decimal) as new (v: string | number) => D;

function toD(v: string | number): D {
  return new Ctor(String(v));
}

function expSafe(x: D): D {
  return x.exp();
}

/**
 * Log-sum-exp for numerical stability: ln(sum_i exp(x_i)) = x_max + ln(sum_i exp(x_i - x_max)).
 */
function logSumExp(values: D[]): D {
  if (values.length === 0) return toD(0);
  const max = values.reduce((a, b) => (a.gte(b) ? a : b));
  let sum = toD(0);
  for (const v of values) {
    sum = sum.plus(expSafe(v.minus(max)));
  }
  return max.plus(sum.ln());
}

/**
 * Cost function: C(q) = b * ln( sum_i exp(q_i / b) ).
 * Uses log-sum-exp to avoid overflow for large q_i/b.
 */
export function calculateCost(q: OutcomeQuantities, b: string): string {
  const bD = toD(b);
  if (bD.lte(0)) throw new Error("LMSR: b must be positive");
  const n = q.length;
  if (n === 0) throw new Error("LMSR: q must have at least one outcome");
  const x: D[] = q.map((qi) => toD(qi).div(bD));
  const lse = logSumExp(x);
  return bD.times(lse).toFixed(DECIMAL_PLACES);
}

/**
 * Marginal (instantaneous) price of outcome i: p_i = exp(q_i/b) / sum_j exp(q_j/b).
 * Returns a value in [0, 1]; outcomes sum to 1.
 */
export function getInstantPrice(q: OutcomeQuantities, b: string, targetOutcome: number): string {
  const bD = toD(b);
  if (bD.lte(0)) throw new Error("LMSR: b must be positive");
  if (targetOutcome < 0 || targetOutcome >= q.length) throw new Error("LMSR: invalid targetOutcome");
  const x = q.map((qi) => toD(qi).div(bD));
  const xMax = x.reduce((a, b) => (a.gte(b) ? a : b));
  const expShifted = x.map((xi) => expSafe(xi.minus(xMax)));
  const sum = expShifted.reduce((a, b) => a.plus(b), toD(0));
  const p = expShifted[targetOutcome].div(sum);
  return p.toFixed(DECIMAL_PLACES);
}

/**
 * Trade cost: C(q_after) - C(q_before). Positive = user pays (buying shares).
 */
export function calculateTradeCost(qBefore: OutcomeQuantities, qAfter: OutcomeQuantities, b: string): string {
  if (qBefore.length !== qAfter.length) throw new Error("LMSR: q length mismatch");
  const cBefore = toD(calculateCost(qBefore, b));
  const cAfter = toD(calculateCost(qAfter, b));
  return cAfter.minus(cBefore).toFixed(DECIMAL_PLACES);
}

/**
 * Apply trade vector to quantities: q_after[i] = q_before[i] + tradeVector[i].
 */
export function applyTradeVector(q: OutcomeQuantities, tradeVector: TradeVector): OutcomeQuantities {
  if (q.length !== tradeVector.length) throw new Error("LMSR: length mismatch");
  return q.map((qi, i) => toD(qi).plus(toD(tradeVector[i])).toFixed(DECIMAL_PLACES));
}

/**
 * Compute cost of a trade defined by tradeVector (delta per outcome).
 * Cost = C(q_after) - C(q_before) where q_after = q + tradeVector.
 */
export function getTradeCostFromVector(q: OutcomeQuantities, b: string, tradeVector: TradeVector): string {
  const qAfter = applyTradeVector(q, tradeVector);
  for (const qa of qAfter) {
    if (toD(qa).lt(0)) throw new Error("LMSR: resulting quantity cannot be negative");
  }
  return calculateTradeCost(q, qAfter, b);
}

/**
 * Worst-case market maker loss (bounded): b * ln(n).
 */
export function worstCaseLoss(b: string, numOutcomes: number): string {
  const bD = toD(b);
  const n = toD(numOutcomes);
  if (n.lte(0)) throw new Error("LMSR: numOutcomes must be positive");
  return bD.times(n.ln()).toFixed(DECIMAL_PLACES);
}

/**
 * Get all instantaneous prices for current state (p_i for each outcome i).
 */
export function getAllPrices(q: OutcomeQuantities, b: string): string[] {
  return q.map((_, i) => getInstantPrice(q, b, i));
}

/**
 * Slippage: for a BUY of outcomeIndex, tradeVector has positive quantity at outcomeIndex only.
 * Returns { instantPrice, tradeCost, qAfter }.
 */
export function getQuoteForBuy(
  q: OutcomeQuantities,
  b: string,
  outcomeIndex: number,
  quantity: string
): { instantPrice: string; tradeCost: string; qAfter: OutcomeQuantities } {
  const tradeVector: TradeVector = q.map((_, i) => (i === outcomeIndex ? quantity : "0"));
  const qAfter = applyTradeVector(q, tradeVector);
  if (toD(qAfter[outcomeIndex]).lt(0)) throw new Error("LMSR: insufficient liquidity for sell");
  const instantPrice = getInstantPrice(q, b, outcomeIndex);
  const tradeCost = getTradeCostFromVector(q, b, tradeVector);
  return { instantPrice, tradeCost, qAfter };
}

/**
 * Quote for SELL: decrease shares of outcomeIndex (tradeVector negative at outcomeIndex).
 */
export function getQuoteForSell(
  q: OutcomeQuantities,
  b: string,
  outcomeIndex: number,
  quantity: string
): { instantPrice: string; tradeCost: string; qAfter: OutcomeQuantities } {
  const negQty = toD(quantity).negated().toFixed(DECIMAL_PLACES);
  const tradeVector: TradeVector = q.map((_, i) => (i === outcomeIndex ? negQty : "0"));
  const qAfter = applyTradeVector(q, tradeVector);
  if (toD(qAfter[outcomeIndex]).lt(0)) throw new Error("LMSR: cannot sell more than outstanding");
  const instantPrice = getInstantPrice(q, b, outcomeIndex);
  const cost = getTradeCostFromVector(q, b, tradeVector);
  return { instantPrice, tradeCost: cost, qAfter };
}
