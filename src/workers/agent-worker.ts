import dotenv from "dotenv";
dotenv.config();

import { Decimal } from "decimal.js";
import { Worker, type Job } from "bullmq";
import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { runTradingAnalysis } from "../services/agent-trading-analysis.service.js";
import { CRE_PENDING_PUBLIC_KEY } from "../schemas/agent.schema.js";

const QUEUE_NAME = "agent-prediction";

interface AgentJobPayload {
  marketId: string;
  agentId: string;
}

async function submitOrderFromWorker(payload: {
  agentId: string;
  marketId: string;
  outcomeIndex: number;
  side: "BID" | "ASK";
  quantity: string;
}): Promise<{ ok: boolean; status: number; body?: unknown }> {
  const apiKey = config.apiKey;
  if (!apiKey?.trim()) {
    return { ok: false, status: 0, body: { error: "API_KEY not set; cannot submit order from worker" } };
  }
  const url = `${config.backendUrl.replace(/\/$/, "")}/api/orders`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      marketId: payload.marketId,
      outcomeIndex: payload.outcomeIndex,
      side: payload.side,
      type: "MARKET",
      quantity: payload.quantity,
      agentId: payload.agentId,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

function agentHasWallet(walletAddress: string | null, publicKey: string): boolean {
  const addr = walletAddress?.trim();
  const pk = publicKey?.trim();
  return Boolean(
    (addr && addr !== CRE_PENDING_PUBLIC_KEY) || (pk && pk !== CRE_PENDING_PUBLIC_KEY)
  );
}

async function createPendingTrade(
  agentId: string,
  marketId: string,
  outcomeIndex: number,
  side: "BID" | "ASK",
  quantity: string,
  pendingReason: "NO_WALLET" | "INSUFFICIENT_BALANCE"
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.pendingAgentTrade.create({
    data: {
      agentId,
      marketId,
      outcomeIndex,
      side,
      quantity: new Decimal(quantity),
      status: "PENDING",
      pendingReason,
    },
  });
  console.log(`Pending trade created: ${pendingReason} (${side} qty=${quantity})`);
}

async function executeAgentLoop(job: Job<AgentJobPayload>): Promise<void> {
  const { marketId, agentId } = job.data;
  console.log(`Agent job: marketId=${marketId} agentId=${agentId}`);

  if (!config.agentTradingEnabled) {
    return;
  }

  const prisma = getPrismaClient();
  const [agent, market] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        persona: true,
        status: true,
        walletAddress: true,
        publicKey: true,
        balance: true,
      },
    }),
    prisma.market.findUnique({
      where: { id: marketId },
      select: { id: true, name: true, outcomes: true, status: true },
    }),
  ]);

  if (!agent || !market) {
    console.log(`Agent or market not found; skipping`);
    return;
  }
  if (agent.status !== "ACTIVE") {
    console.log(`Agent ${agentId} not ACTIVE; skipping`);
    return;
  }
  if (market.status !== "OPEN") {
    console.log(`Market ${marketId} not OPEN; skipping`);
    return;
  }

  const outcomes = Array.isArray(market.outcomes)
    ? (market.outcomes as unknown[]).map((o) => String(o))
    : [];
  if (outcomes.length === 0) {
    console.log(`Market ${marketId} has no outcomes; skipping`);
    return;
  }

  const decision = await runTradingAnalysis({
    marketName: market.name,
    outcomes,
    agentName: agent.name,
    personaSummary: agent.persona?.slice(0, 500),
  });

  if (decision.action === "skip") {
    console.log(`Decision: skip. ${decision.reason ?? ""}`);
    return;
  }

  const outcomeIndex = decision.outcomeIndex ?? 0;
  const quantity = decision.quantity ?? "1";
  const side = decision.action === "buy" ? "BID" : "ASK";

  const hasWallet = agentHasWallet(agent.walletAddress, agent.publicKey);
  if (!hasWallet) {
    await createPendingTrade(agentId, marketId, outcomeIndex, side, quantity, "NO_WALLET");
    return;
  }

  const balance = new Decimal(agent.balance.toString());
  const qty = new Decimal(quantity);
  if (balance.lt(qty)) {
    await createPendingTrade(agentId, marketId, outcomeIndex, side, quantity, "INSUFFICIENT_BALANCE");
    return;
  }

  const result = await submitOrderFromWorker({
    agentId,
    marketId,
    outcomeIndex,
    side,
    quantity,
  });

  if (result.ok) {
    console.log(`Order submitted: ${side} outcomeIndex=${outcomeIndex} quantity=${quantity}`);
  } else {
    console.error(`Order failed: status=${result.status} body=${JSON.stringify(result.body)}`);
  }
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
