import dotenv from "dotenv";
dotenv.config();

import { Worker, type Job } from "bullmq";
import { config } from "../config/index.js";

const QUEUE_NAME = "agent-prediction";

interface AgentJobPayload {
  marketId: string;
  agentId: string;
}

async function executeAgentLoop(job: Job<AgentJobPayload>): Promise<void> {
  const { marketId, agentId } = job.data;
  console.log(`Agent job received: marketId=${marketId} agentId=${agentId}`);
  // This worker does not place orders or open positions. Enqueue only adds the market to the agent's list.
  // To have the agent trade: an external runner or script must call POST /api/orders with x-api-key and body.agentId.
  // On-chain execution (PredictionVault executeTrade) uses CRE to sign DON quotes; in-app order book does not call CRE.
}

async function main(): Promise<void> {
  const worker = new Worker<AgentJobPayload>(
    QUEUE_NAME,
    async (job) => executeAgentLoop(job),
    { connection: { url: config.redisUrl }, concurrency: 5 }
  );

  worker.on("completed", (job) => console.log(`Job ${job.id} completed`));
  worker.on("failed", (job, err) => console.error(`Job ${job?.id} failed:`, err));

  const shutdown = async () => {
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
