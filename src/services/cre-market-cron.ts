/**
 * Optional in-process job: POST createMarketsFromBackend to CRE on an interval.
 * When creMarketCronBatchPayload is true (default), backend generates markets and sends
 * them in the request body so CRE creates all in one run and uses one batch callback (no HTTP cap).
 * Payloads are filtered so markets with an existing questionId in DB are not sent.
 * On successful send, payloads are added to the pending pool for getMarket polling.
 */

import type { FastifyBaseLogger } from "fastify";
import { config } from "../config/index.js";
import {
  getDraftMarketsForCre,
  createDraftMarketsFromAgents,
  filterPayloadsByExistingQuestionId,
  generateAgentMarkets,
} from "./agent-market-creation.service.js";
import { addPending, runPoll } from "./cre-pending-markets.js";
import type { CreCreateMarketPayload, CreDraftPayloadForCre } from "../types/agent-markets.js";

const POLL_INTERVAL_MS = 5_000;

let intervalId: ReturnType<typeof setInterval> | null = null;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;

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
      const limit = config.agentMarketsPerJob;
      let drafts = await getDraftMarketsForCre(limit);
      if (drafts.length === 0) {
        const { created } = await createDraftMarketsFromAgents(limit);
        if (created > 0) drafts = await getDraftMarketsForCre(limit);
      }
      if (drafts.length > 0) {
        body.markets = drafts;
        log.info(
          { count: drafts.length },
          "CRE cron sending draft markets in body (batch create with marketId)"
        );
      }
    } catch (err) {
      log.warn({ err }, "Draft market fetch/create failed; CRE will fetch via GET (cap 4)");
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
      const sent = (body.markets as unknown[] | undefined) ?? [];
      if (Array.isArray(sent) && sent.length > 0) {
        addPending(sent as (CreCreateMarketPayload | CreDraftPayloadForCre)[]);
      }
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

  if (config.chainRpcUrl?.trim()) {
    pollIntervalId = setInterval(() => {
      runPoll().catch((err) => log.warn({ err }, "CRE pending markets poll error"));
    }, POLL_INTERVAL_MS);
    log.info({ intervalMs: POLL_INTERVAL_MS }, "CRE pending markets poll started");
  }
}

export function stopCreMarketCron(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (pollIntervalId !== null) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
}
