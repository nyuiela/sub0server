import { Queue } from "bullmq";
import { config } from "../config/index.js";

const QUEUE_NAME = "agent-prediction";

let agentQueue: Queue<AgentJobPayload> | null = null;

export interface AgentJobPayload {
  marketId: string;
  agentId: string;
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
  const job = await queue.add("predict", payload, {
    repeat: { every: 60_000 },
    jobId: `${payload.agentId}-${payload.marketId}`,
  });
  return job.id ?? "";
}
