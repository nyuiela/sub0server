/**
 * Test script for the simulation pricing engine.
 * Generates random (markets, minutes) pairs and prints the computed USDC price.
 * Run: npm run pricing-test   or   npx tsx src/scripts/pricing-engine-test.ts
 * Optional: PRICING_SAMPLES=20 npm run pricing-test
 */

import {
  SIMULATE_PRICE_BASE_USDC,
  SIMULATE_PRICE_PER_MARKET_USDC,
  SIMULATE_PRICE_PER_MINUTE_USDC,
  computeSimulatePriceUsdc,
  usdcToAtomic,
} from "../x402/pricing.js";

const DEFAULT_SAMPLES = 15;
const MAX_MARKETS = 500;
const MAX_MINUTES = 600;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function main(): void {
  const samples = Math.max(1, parseInt(process.env.PRICING_SAMPLES ?? "", 10) || DEFAULT_SAMPLES);

  console.log("=== Simulation pricing engine test ===\n");
  console.log("Current constants (edit src/x402/pricing.ts to change):");
  console.log(`  SIMULATE_PRICE_BASE_USDC         = ${SIMULATE_PRICE_BASE_USDC}`);
  console.log(`  SIMULATE_PRICE_PER_MARKET_USDC  = ${SIMULATE_PRICE_PER_MARKET_USDC}`);
  console.log(`  SIMULATE_PRICE_PER_MINUTE_USDC   = ${SIMULATE_PRICE_PER_MINUTE_USDC}`);
  console.log("\nFormula: base + (markets * perMarket) + (minutes * perMinute)\n");

  const rows: { markets: number; minutes: number; usdc: number; atomic: string }[] = [];
  for (let i = 0; i < samples; i++) {
    const markets = randomInt(1, MAX_MARKETS);
    const minutes = randomInt(1, MAX_MINUTES);
    const usdc = computeSimulatePriceUsdc(markets, minutes);
    const atomic = usdcToAtomic(usdc);
    rows.push({ markets, minutes, usdc, atomic });
  }

  rows.sort((a, b) => a.usdc - b.usdc);

  const colMarkets = "Markets";
  const colMinutes = "Minutes";
  const colUsdc = "USDC";
  const colAtomic = "Atomic (on-chain)";
  const wM = Math.max(colMarkets.length, 8);
  const wMin = Math.max(colMinutes.length, 8);
  const wU = Math.max(colUsdc.length, 10);
  const pad = (s: string, w: number) => s.padEnd(w);

  console.log(`${pad(colMarkets, wM)}  ${pad(colMinutes, wMin)}  ${pad(colUsdc, wU)}  ${colAtomic}`);
  console.log("-".repeat(wM + wMin + wU + 4 + colAtomic.length));

  for (const r of rows) {
    console.log(
      `${String(r.markets).padEnd(wM)}  ${String(r.minutes).padEnd(wMin)}  ${r.usdc.toFixed(2).padEnd(wU)}  ${r.atomic}`
    );
  }

  console.log("\nOptional: PRICING_SAMPLES=30 npm run pricing-test  (default 15)");
}

main();
