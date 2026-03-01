/**
 * Reset the agent-prediction BullMQ queue: remove all jobs and repeatable config.
 * Use after clearing DB data so the worker does not process jobs for deleted markets/agents.
 * Run from sub0server: pnpm queue:reset
 */

import dotenv from "dotenv";
dotenv.config();

import { getAgentQueue } from "../workers/queue.js";

async function main(): Promise<void> {
  const queue = await getAgentQueue();
  const counts = await queue.getJobCounts();
  const total =
    (counts.waiting ?? 0) +
    (counts.delayed ?? 0) +
    (counts.active ?? 0) +
    (counts.completed ?? 0) +
    (counts.failed ?? 0) +
    (counts.paused ?? 0) +
    (counts.prioritized ?? 0) +
    (counts["waiting-children"] ?? 0);

  if (total === 0) {
    console.log("Agent queue (agent-prediction): no jobs found. Queue is already empty.");
  } else {
    console.log(
      `Agent queue (agent-prediction): found ${total} job(s) (waiting: ${counts.waiting ?? 0}, delayed: ${counts.delayed ?? 0}, active: ${counts.active ?? 0}, completed: ${counts.completed ?? 0}, failed: ${counts.failed ?? 0}).`
    );
  }

  await queue.obliterate({ force: true });
  await queue.close();

  if (total > 0) {
    console.log(`Reset complete: ${total} job(s) and repeatable config removed.`);
  }
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
