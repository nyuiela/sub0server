/**
 * News ingestion worker: polls RSS + CryptoPanic every NEWS_POLL_INTERVAL_MS,
 * filters by NEWS_FILTER_CURRENCIES, and stores in FeedItem.
 * Run: pn news-ingest
 */

import "dotenv/config";
import { config } from "../config/index.js";
import { runIngestCycle } from "../services/news-ingest.service.js";

const POLL_MS = config.newsPollIntervalMs;

async function main(): Promise<void> {
  console.log(`News ingest started (poll every ${POLL_MS}ms)`);
  if (config.newsFilterCurrencies.length > 0) {
    console.log("Filter currencies:", config.newsFilterCurrencies.join(", "));
  }
  if (!config.cryptopanicApiKey) {
    console.log("CryptoPanic disabled (no CRYPTOPANIC_API_KEY)");
  }

  const run = async (): Promise<void> => {
    try {
      const saved = await runIngestCycle();
      if (saved > 0) console.log(`Ingest: ${saved} new items`);
    } catch (err) {
      console.error("Ingest cycle error:", err instanceof Error ? err.message : String(err));
    }
    setTimeout(run, POLL_MS);
  };
  await run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
