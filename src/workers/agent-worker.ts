import dotenv from "dotenv";
dotenv.config();

import { Decimal } from "decimal.js";
import { Worker, type Job } from "bullmq";
import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { getAgentBalanceForChain } from "../lib/agent-chain-balance.js";
import { runTradingAnalysis } from "../services/agent-trading-analysis.service.js";
import { CRE_PENDING_PUBLIC_KEY, CRE_PENDING_PRIVATE_KEY } from "../schemas/agent.schema.js";
import type { AgentChainKey } from "../types/agent-chain.js";
import { CHAIN_KEY_MAIN, CHAIN_KEY_TENDERLY } from "../types/agent-chain.js";
import { isAgentChainKey } from "../types/agent-chain.js";

const QUEUE_NAME = "agent-prediction";
const DEFAULT_FOLLOW_UP_AFTER_TRADE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FOLLOW_UP_AFTER_SKIP_MS = 60 * 60 * 1000;

interface AgentJobPayload {
  marketId: string;
  agentId: string;
  chainKey?: AgentChainKey;
}

async function submitOrderFromWorker(payload: {
  agentId: string;
  marketId: string;
  outcomeIndex: number;
  side: "BID" | "ASK";
  quantity: string;
  chainKey?: AgentChainKey | null;
}): Promise<{ ok: boolean; status: number; body?: unknown }> {
  const apiKey = config.apiKey;
  if (!apiKey?.trim()) {
    return { ok: false, status: 0, body: { error: "API_KEY not set; cannot submit order from worker" } };
  }
  const url = `${config.backendUrl.replace(/\/$/, "")}/api/orders`;
  const body: Record<string, unknown> = {
    marketId: payload.marketId,
    outcomeIndex: payload.outcomeIndex,
    side: payload.side,
    type: "MARKET",
    quantity: payload.quantity,
    agentId: payload.agentId,
  };
  if (payload.chainKey != null && payload.chainKey !== CHAIN_KEY_MAIN) {
    body.chainKey = payload.chainKey;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: responseBody };
}

async function syncAgentBalanceFromBackend(agentId: string, chainKey?: string): Promise<void> {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) return;
  const url = `${config.backendUrl.replace(/\/$/, "")}/api/agents/${encodeURIComponent(agentId)}/sync-balance`;
  const isMain = chainKey !== CHAIN_KEY_TENDERLY;
  if (isMain && !config.chainRpcUrl?.trim()) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: chainKey === CHAIN_KEY_TENDERLY ? JSON.stringify({ chainKey: CHAIN_KEY_TENDERLY }) : undefined,
    });
    if (res.ok) {
      console.log(`Synced agent balance for ${agentId} (${chainKey ?? "main"})`);
    }
  } catch (err) {
    console.error(`Sync balance failed for ${agentId}:`, err);
  }
}

function agentHasCompleteWallet(
  walletAddress: string | null,
  publicKey: string,
  encryptedPrivateKey: string | null
): boolean {
  const addr = walletAddress?.trim() || publicKey?.trim();
  if (!addr || addr === CRE_PENDING_PUBLIC_KEY) return false;
  const key = encryptedPrivateKey?.trim();
  return Boolean(key && key !== CRE_PENDING_PRIVATE_KEY);
}

async function createPendingTrade(
  agentId: string,
  marketId: string,
  outcomeIndex: number,
  side: "BID" | "ASK",
  quantity: string,
  pendingReason: "NO_WALLET" | "INSUFFICIENT_BALANCE" | "INSUFFICIENT_POSITION"
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

/**
 * Chain logic:
 * - chainKey "main" = live trading: balance from Agent.balance / AgentChainBalance(main), no date-range context. After a trade we sync balance from main chain.
 * - chainKey "tenderly" = simulation: balance from AgentChainBalance(tenderly) (funded by /api/simulate/fund), simulateDateRange for as-of context. After a trade we sync balance from Tenderly so the simulate tab shows the updated balance.
 * Order submission (POST /api/orders) and CRE execution do not receive chainKey; CRE is expected to use Tenderly when running in simulate mode (e.g. same CRE_HTTP_URL with workflow configured for Tenderly RPC).
 */
async function executeAgentLoop(job: Job<AgentJobPayload>): Promise<void> {
  const { marketId, agentId, simulationId, chainKey = CHAIN_KEY_MAIN } = job.data;
  console.log(`Agent job: marketId=${marketId} agentId=${agentId} simulationId=${simulationId ?? "(main)"}`);

  if (!config.agentTradingEnabled) {
    return;
  }

  const prisma = getPrismaClient();
  const isSimulate = chainKey !== CHAIN_KEY_MAIN;
  const simId = simulationId ?? null;
  if (simId != null) {
    const sim = await prisma.simulation.findUnique({
      where: { id: simId },
      select: { status: true },
    });
    if (sim?.status === "COMPLETED" || sim?.status === "CANCELLED") {
      console.log(`Simulation ${simId} is ${sim.status}; skipping job`);
      return;
    }
  }
  const [enqueued, agent, market] = await Promise.all([
    prisma.agentEnqueuedMarket.findFirst({
      where: { agentId, marketId, simulationId: simId },
      select: {
        nextRunAt: true,
        simulateDateRangeStart: true,
        simulateDateRangeEnd: true,
      },
    }),
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
        modelSettings: true,
        encryptedPrivateKey: true,
        openclaw: true,
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
  const nextRunAt = enqueued?.nextRunAt;
  if (nextRunAt && nextRunAt.getTime() > Date.now()) {
    console.log(`Market ${marketId} nextRunAt not yet due; skipping`);
    return;
  }
  if (agent.status !== "ACTIVE") {
    console.log(`Agent ${agentId} not ACTIVE; skipping`);
    return;
  }
  if (!isSimulate && market.status !== "OPEN") {
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

  const positionChainWhere =
    chainKey === CHAIN_KEY_TENDERLY
      ? { chainKey: CHAIN_KEY_TENDERLY }
      : { OR: [{ chainKey: "main" }, { chainKey: null }] };
  const positions = await prisma.position.findMany({
    where: { agentId, marketId, status: "OPEN", ...positionChainWhere },
    select: { outcomeIndex: true, side: true, collateralLocked: true },
  });
  const currentPositions = positions.map((p) => ({
    outcomeIndex: p.outcomeIndex,
    side: p.side,
    quantity: p.collateralLocked.toString(),
  }));

  const simulationContext =
    isSimulate && enqueued?.simulateDateRangeEnd
      ? {
          asOfDate: enqueued.simulateDateRangeEnd.toISOString(),
          dateRangeEnd: enqueued.simulateDateRangeEnd.toISOString(),
          dateRangeStart: enqueued.simulateDateRangeStart?.toISOString(),
        }
      : undefined;

  const modelSettings = agent.modelSettings as { model?: string } | null;
  const openclaw = agent.openclaw as { soul?: string | null; persona?: string | null; skill?: string | null } | null;
  const personaParts: string[] = [];
  if (agent.persona?.trim()) personaParts.push(agent.persona.trim());
  if (openclaw?.soul?.trim()) personaParts.push("[Soul]\n" + openclaw.soul.trim());
  if (openclaw?.skill?.trim()) personaParts.push("[Skill]\n" + openclaw.skill.trim());
  const personaSummary = personaParts.length > 0 ? personaParts.join("\n\n").slice(0, 2000) : undefined;
  const decision = await runTradingAnalysis({
    marketName: market.name,
    outcomes,
    agentName: agent.name,
    personaSummary: personaSummary ?? agent.persona?.slice(0, 500),
    model: modelSettings?.model,
    simulationContext,
    currentPositions,
  });

  if (decision.action === "skip") {
    console.log(`Decision: skip. ${decision.reason ?? ""}`);
    const followUpMs = decision.nextFollowUpInMs ?? DEFAULT_FOLLOW_UP_AFTER_SKIP_MS;
    const nextRun = new Date(Date.now() + followUpMs);
    await prisma.agentEnqueuedMarket.updateMany({
      where: { agentId, marketId, simulationId: simulationId ?? null },
      data: {
        status: "DISCARDED",
        discardReason: decision.reason?.slice(0, 2000) ?? null,
        nextRunAt: followUpMs > 0 ? nextRun : null,
      },
    });
    return;
  }

  const outcomeIndex = decision.outcomeIndex ?? 0;
  const quantity = decision.quantity ?? "1";
  const side = decision.action === "buy" ? "BID" : "ASK";

  const hasWallet = agentHasCompleteWallet(
    agent.walletAddress,
    agent.publicKey,
    agent.encryptedPrivateKey
  );
  if (!hasWallet) {
    await createPendingTrade(agentId, marketId, outcomeIndex, side, quantity, "NO_WALLET");
    return;
  }

  const qty = new Decimal(quantity);
  if (side === "ASK") {
    const longForOutcome = positions
      .filter((p) => p.outcomeIndex === outcomeIndex && p.side === "LONG")
      .reduce((sum, p) => sum.plus(p.collateralLocked.toString()), new Decimal(0));
    if (longForOutcome.lt(qty)) {
      await createPendingTrade(agentId, marketId, outcomeIndex, side, quantity, "INSUFFICIENT_POSITION");
      return;
    }
  } else {
    const balanceStr = await getAgentBalanceForChain(agentId, chainKey);
    const balance = new Decimal(balanceStr ?? "0");
    if (balance.lt(qty)) {
      await createPendingTrade(agentId, marketId, outcomeIndex, side, quantity, "INSUFFICIENT_BALANCE");
      return;
    }
  }

  const result = await submitOrderFromWorker({
    agentId,
    marketId,
    outcomeIndex,
    side,
    quantity,
    chainKey,
  });

  if (result.ok) {
    console.log(`Order submitted: ${side} outcomeIndex=${outcomeIndex} quantity=${quantity}`);
    const followUpMs = decision.nextFollowUpInMs ?? DEFAULT_FOLLOW_UP_AFTER_TRADE_MS;
    const nextRun = new Date(Date.now() + followUpMs);
    await prisma.agentEnqueuedMarket.updateMany({
      where: { agentId, marketId, simulationId: simulationId ?? null },
      data: { status: "TRADED", nextRunAt: nextRun },
    });
    void syncAgentBalanceFromBackend(agentId, chainKey);
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
