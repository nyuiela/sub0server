import { Queue } from "bullmq";
import { config } from "../config/index.js";
import type { AgentChainKey } from "../types/agent-chain.js";
import { CHAIN_KEY_MAIN } from "../types/agent-chain.js";

const QUEUE_NAME = "agent-prediction";

let agentQueue: Queue<AgentJobPayload> | null = null;

export interface AgentJobPayload {
  marketId: string;
  agentId: string;
  /** Trading place: main (CHAIN_RPC_URL) or tenderly (simulate). Default main. */
  chainKey?: AgentChainKey;
}

export async function getAgentQueue(): Promise<Queue<AgentJobPayload>> {
  if (agentQueue === null) {
    agentQueue = new Queue<AgentJobPayload>(QUEUE_NAME, {
      connection: { url: config.redisUrl },
    });
  }
  return agentQueue;
}

export async function enqueueAgentPrediction(payload: AgentJobPayload): Promise<string> {
  const queue = await getAgentQueue();
  const chainKey = payload.chainKey ?? CHAIN_KEY_MAIN;
  const job = await queue.add("predict", { ...payload, chainKey }, {
    repeat: { every: 60_000 },
    jobId: `${payload.agentId}-${payload.marketId}`,
  });
  return job.id ?? "";
}

/** Add a one-off job to run analysis immediately (manual trigger). */
export async function enqueueAgentPredictionNow(payload: AgentJobPayload): Promise<string> {
  const queue = await getAgentQueue();
  const chainKey = payload.chainKey ?? CHAIN_KEY_MAIN;
  const job = await queue.add("predict", { ...payload, chainKey }, {
    jobId: `now-${payload.agentId}-${payload.marketId}-${Date.now()}`,
  });
  return job.id ?? "";
}
