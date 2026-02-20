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
  // Prediction/trade logic was built for the previous schema (probability, poolLong, poolShort, PriceFeed).
  // With the new platform schema (Market with conditionId, outcomes, etc.) implement custom agent logic here.
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
