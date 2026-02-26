/**
 * Optional in-process job: POST createMarketsFromBackend to CRE on an interval.
 * Only runs when config.creMarketCronEnabled and config.creHttpUrl are set.
 * CRE must be deployed and listening; this just triggers it periodically.
 */

import type { FastifyBaseLogger } from "fastify";
import { config } from "../config/index.js";

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
