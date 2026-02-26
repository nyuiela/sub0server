/**
 * Generates agent market payloads only (Gemini + Grok). No server, no CRE, no DB.
 * Just calls the service and prints the JSON payloads to stdout.
 *
 * Usage:
 *   tsx src/scripts/generate-agent-markets-only.ts
 *   tsx src/scripts/generate-agent-markets-only.ts --count=5
 *
 * Requires in .env: GEMINI_API_KEY. Optional: XAI_API_KEY (for Grok; Grok is XAI, one key).
 */

import dotenv from "dotenv";
dotenv.config();

import { generateAgentMarkets } from "../services/agent-market-creation.service.js";

async function main() {
  const args = process.argv.slice(2);
  const countArg = args.find((a) => a.startsWith("--count="));
  const count = countArg ? parseInt(countArg.split("=")[1] ?? "10", 10) : 10;

  const payloads = await generateAgentMarkets(count);
  console.log(JSON.stringify({ data: payloads, count: payloads.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
