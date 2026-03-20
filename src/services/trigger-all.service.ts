/**
 * Trigger-all logic: discovery (enqueue new OPEN markets per agent) + enqueue due jobs for MAIN.
 * Used by POST /api/agent/trigger-all and by the in-process cron when TRIGGER_ALL_CRON_ENABLED=true.
 *
 * CRE delegation flags:
 * - TRIGGER_ALL_CRE_DELEGATED=true: Discovery still writes AgentEnqueuedMarket rows but skips BullMQ
 *   job enqueue. The CRE agent-analysis workflow picks them up via /api/internal/cre/enqueued-markets.
 * - CRE_WORKER_MODE=true: Full CRE worker mode. All BullMQ processing is skipped.
 */

import type { FastifyBaseLogger } from "fastify";
import { getPrismaClient } from "../lib/prisma.js";
import { enqueueAgentPrediction, enqueueAgentPredictionNow } from "../workers/queue.js";
import { config } from "../config/index.js";
import { CHAIN_KEY_MAIN } from "../types/agent-chain.js";
import { isAgentChainKey } from "../types/agent-chain.js";

export interface TriggerAllResult {
  discovered: number;
  triggered: number;
  jobIds: string[];
}

export async function runTriggerAll(log?: FastifyBaseLogger): Promise<TriggerAllResult> {
  const prisma = getPrismaClient();
  const creWorkerMode = config.creWorkerMode;
  const creeDelegated = creWorkerMode || config.triggerAllCreDelegated;
  let discovered = 0;

  if (config.agentDiscoveryEnabled) {
    const openMarkets = await prisma.market.findMany({
      where: { status: "OPEN", questionId: { not: null } },
      take: config.agentDiscoveryMarketsLimit,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const openMarketIds = openMarkets.map((m) => m.id);
    const agents = await prisma.agent.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    const maxNew = config.agentDiscoveryMaxNewPerAgentPerRun;

    for (const agent of agents) {
      const existing = await prisma.agentEnqueuedMarket.findMany({
        where: { agentId: agent.id, chainKey: CHAIN_KEY_MAIN, simulationId: null },
        select: { marketId: true },
      });
      const existingSet = new Set(existing.map((r) => r.marketId));
      let added = 0;
      for (const marketId of openMarketIds) {
        if (added >= maxNew) break;
        if (existingSet.has(marketId)) continue;

        if (!creeDelegated) {
          await enqueueAgentPrediction({ marketId, agentId: agent.id, chainKey: CHAIN_KEY_MAIN });
        }

        const row = await prisma.agentEnqueuedMarket.findFirst({
          where: { agentId: agent.id, marketId, simulationId: null },
        });
        if (row) {
          await prisma.agentEnqueuedMarket.update({
            where: { id: row.id },
            data: { chainKey: CHAIN_KEY_MAIN },
          });
        } else {
          await prisma.agentEnqueuedMarket.create({
            data: {
              agentId: agent.id,
              marketId,
              simulationId: null,
              chainKey: CHAIN_KEY_MAIN,
              tradeReason: creeDelegated
                ? "Auto-enqueued by trigger-all (CRE delegation active)"
                : "Auto-enqueued by trigger-all",
            },
          });
        }
        existingSet.add(marketId);
        added++;
        discovered++;
      }
    }
  }

  if (creWorkerMode) {
    if (log) {
      log.info({ discovered, creWorkerMode: true }, "trigger-all: CRE_WORKER_MODE active; skipping BullMQ job dispatch");
    }
    return { discovered, triggered: 0, jobIds: [] };
  }

  const now = new Date();
  const rows = await prisma.agentEnqueuedMarket.findMany({
    where: {
      chainKey: CHAIN_KEY_MAIN,
      simulationId: null,
      status: { in: ["PENDING", "TRADED"] },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    select: { agentId: true, marketId: true, chainKey: true },
  });
  const jobIds: string[] = [];

  if (!creeDelegated) {
    for (const row of rows) {
      const chainKey = isAgentChainKey(row.chainKey) ? row.chainKey : CHAIN_KEY_MAIN;
      const jobId = await enqueueAgentPredictionNow({
        agentId: row.agentId,
        marketId: row.marketId,
        chainKey,
      });
      jobIds.push(jobId);
    }
  }

  if (log) {
    log.info(
      { discovered, triggered: jobIds.length, creeDelegated },
      "trigger-all run"
    );
  }
  return { discovered, triggered: jobIds.length, jobIds };
}
