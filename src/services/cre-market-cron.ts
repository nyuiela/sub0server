/**
 * Optional in-process job: POST createMarketsFromBackend to CRE on an interval.
 * When creMarketCronBatchPayload is true (default), backend generates markets and sends
 * them in the request body so CRE creates all in one run and uses one batch callback (no HTTP cap).
 */

import type { FastifyBaseLogger } from "fastify";
import { config } from "../config/index.js";
import { generateAgentMarkets } from "./agent-market-creation.service.js";

let intervalId: ReturnType<typeof setInterval> | null = null;

async function triggerCreateMarketsFromBackend(log: FastifyBaseLogger): Promise<void> {
  const url = config.creHttpUrl;
  if (!url?.trim()) return;
  const body: Record<string, unknown> = { action: "createMarketsFromBackend" };
  const apiKey = config.apiKey ?? config.creHttpApiKey;
  if (apiKey) body.apiKey = apiKey;
  if (config.creMarketCronBroadcast) {
    body.broadcast = true;
    log.info("CRE cron sending broadcast=true (real onchain txs)");
  }
  if (config.creMarketCronBatchPayload) {
    try {
      const count = config.agentMarketsPerJob;
      const payloads = await generateAgentMarkets(count);
      if (payloads.length > 0) {
        body.markets = payloads;
        log.info({ count: payloads.length }, "CRE cron sending markets in body (batch create)");
      }
    } catch (err) {
      log.warn({ err }, "Agent market generation failed; CRE will fetch via GET (cap 4)");
    }
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) {
      log.info({ status: res.status }, "CRE createMarketsFromBackend triggered");
    } else {
      log.warn({ status: res.status, body: text.slice(0, 200) }, "CRE createMarketsFromBackend failed");
    }
  } catch (err) {
    log.warn({ err }, "CRE createMarketsFromBackend request error");
  }
}

export function startCreMarketCron(log: FastifyBaseLogger): void {
  if (!config.creMarketCronEnabled || !config.creHttpUrl?.trim()) {
    return;
  }
  const ms = config.creMarketCronIntervalMs;
  log.info({ intervalMs: ms }, "CRE market cron started (createMarketsFromBackend)");
  triggerCreateMarketsFromBackend(log);
  intervalId = setInterval(() => {
    triggerCreateMarketsFromBackend(log);
  }, ms);
}

export function stopCreMarketCron(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
