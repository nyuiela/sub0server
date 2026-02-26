/**
 * Script to run agent market creation flow:
 * 1. Calls GET /api/internal/agent-markets to fetch AI-generated payloads (Gemini + Grok).
 * 2. Optionally for each payload: trigger CRE createMarket and then POST /api/internal/markets/onchain-created.
 *
 * Usage:
 *   API_KEY=your-key BACKEND_URL=http://localhost:3000 tsx src/scripts/run-agent-market-creation.ts
 *   API_KEY=your-key BACKEND_URL=http://localhost:3000 tsx src/scripts/run-agent-market-creation.ts --count=5
 *   API_KEY=your-key tsx src/scripts/run-agent-market-creation.ts --dry-run   (only fetch and log payloads)
 *
 * Requires: API_KEY (must match backend), BACKEND_URL (default http://localhost:3000).
 */

import dotenv from "dotenv";
dotenv.config();

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const API_KEY = process.env.API_KEY ?? "";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const countArg = args.find((a) => a.startsWith("--count="));
  const count = countArg ? parseInt(countArg.split("=")[1] ?? "10", 10) : undefined;

  if (!API_KEY) {
    console.error("API_KEY is required. Set it in .env or export API_KEY=...");
    process.exit(1);
  }

  const url = new URL("/api/internal/agent-markets", BACKEND_URL);
  if (count != null && count > 0) url.searchParams.set("count", String(count));

  console.log("Fetching agent markets from", url.toString());
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("Agent markets request failed:", res.status, text);
    process.exit(1);
  }

  const body = (await res.json()) as { data?: unknown[]; count?: number };
  const payloads = body.data ?? [];
  const total = body.count ?? payloads.length;

  console.log("Received", total, "market payload(s).");
  if (payloads.length === 0) {
    console.log("No markets to create. Exiting.");
    return;
  }

  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i] as Record<string, unknown>;
    console.log(
      `[${i + 1}/${payloads.length}] ${(p.agentSource as string) ?? "?"} | ${(p.question as string) ?? "?"}`
    );
  }

  if (dryRun) {
    console.log("Dry run: not calling CRE or onchain-created callback.");
    return;
  }

  console.log(
    "To create these on-chain, trigger CRE createMarket for each payload (e.g. via CRE cron or HTTP trigger), then call POST /api/internal/markets/onchain-created with questionId, createMarketTxHash, and payload fields including agentSource."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
