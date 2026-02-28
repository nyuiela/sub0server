/**
 * Simulation pricing for x402. Formula: base + perMarket * markets + perMinute * duration.
 * Must stay in sync with frontend SimulateDiscoveredColumn constants.
 * Tuned so small runs (e.g. 10 markets, 45 min) are ~1–2 USDC.
 */

export const SIMULATE_PRICE_BASE_USDC = 0.5;
export const SIMULATE_PRICE_PER_MARKET_USDC = 0.02;
export const SIMULATE_PRICE_PER_MINUTE_USDC = 0.02;

const USDC_DECIMALS = 6;

export function computeSimulatePriceUsdc(
  maxMarkets: number,
  durationMinutes: number
): number {
  return (
    SIMULATE_PRICE_BASE_USDC +
    maxMarkets * SIMULATE_PRICE_PER_MARKET_USDC +
    durationMinutes * SIMULATE_PRICE_PER_MINUTE_USDC
  );
}

/** USDC atomic units (1 USDC = 10^6). */
export function usdcToAtomic(usdc: number): string {
  const clamped = Math.max(0, usdc);
  const atomic = Math.floor(clamped * Math.pow(10, USDC_DECIMALS));
  return String(atomic);
}
