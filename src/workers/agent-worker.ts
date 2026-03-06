import dotenv from "dotenv";
dotenv.config();

import { Decimal } from "decimal.js";
import { Worker, type Job } from "bullmq";
import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { getAgentBalanceForChain } from "../lib/agent-chain-balance.js";
import { runTradingAnalysis } from "../services/agent-trading-analysis.service.js";
import { createOrUpdateAgentPosition } from "../services/agent-position-creation.service.js";
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
  simulationId?: string;
}

async function submitOrderFromWorker(payload: {
  agentId: string;
  marketId: string;
  outcomeIndex: number;
  side: "BID" | "ASK";
  quantity: string;
  chainKey?: AgentChainKey | null;
  userSignature?: string;
}): Promise<{ ok: boolean; status: number; body?: unknown }> {
  const apiKey = config.apiKey;
  if (!apiKey?.trim()) {
    return { ok: false, status: 0, body: { error: "API_KEY not set; cannot submit order from worker" } };
  }

  // Get agent info for signing
  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id: payload.agentId },
    select: {
      id: true,
      walletAddress: true,
      encryptedPrivateKey: true,
    },
  });

  if (!agent) {
    return { ok: false, status: 404, body: { error: "Agent not found" } };
  }

  // Check if this is an agent order that needs signing (worker payload has agentId only)
  const isAgentOrder = Boolean(payload.agentId);
  let userSignature = payload.userSignature;

  if (isAgentOrder && !userSignature) {
    // This is an agent order - sign it with agent's private key
    try {
      // Import signing dependencies
      const { createWalletClient, http } = await import("viem");
      const { sepolia } = await import("viem/chains");
      const { privateKeyToAccount } = await import("viem/accounts");
      const { decryptPrivateKey } = await import("../services/agent-keys.service.js");
      const { buildUserTradeTypedData } = await import("../lib/signature.js");

      // Check if agent has private key
      if (!agent.encryptedPrivateKey) {
        console.log("⚠️ No encrypted private key available for agent order signing");
        return { ok: false, status: 400, body: { error: "Agent has no private key for signing" } };
      }

      // Decrypt private key
      const privateKey = decryptPrivateKey(agent.encryptedPrivateKey);
      if (!privateKey) {
        console.log("⚠️ Could not decrypt agent private key");
        return { ok: false, status: 500, body: { error: "Failed to decrypt private key" } };
      }

      // Create account from private key
      const account = privateKeyToAccount(privateKey as `0x${string}`);
      
      // Verify account matches agent wallet
      if (account.address.toLowerCase() !== (agent.walletAddress || "").toLowerCase()) {
        console.log(`⚠️ Account mismatch: derived ${account.address} vs agent ${agent.walletAddress}`);
        return { ok: false, status: 400, body: { error: "Account address mismatch" } };
      }

      // Generate nonce and deadline
      const nonce = BigInt(Date.now());
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

      // Build EIP-712 typed data
      const typedData = buildUserTradeTypedData({
        questionId: payload.marketId,
        outcomeIndex: payload.outcomeIndex,
        buy: payload.side === "BID",
        quantity: payload.quantity,
        maxCostUsdc: payload.quantity, // Use quantity as max cost
        nonce: nonce.toString(),
        deadline,
      });

      // Create wallet client for signing
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(process.env.CHAIN_RPC_URL || "https://sepolia.drpc.org"),
      });

      // Sign the typed data
      const signature = await walletClient.signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      userSignature = signature;
      console.log(`✅ Agent order signed with EIP-712 signature`);
      console.log(`Signature: ${signature.slice(0, 20)}...${signature.slice(-20)}`);

    } catch (error) {
      console.error("❌ Failed to sign agent order:", error);
      return { ok: false, status: 500, body: { error: "Failed to sign order" } };
    }
  }

  const url = `${config.backendUrl.replace(/\/$/, "")}/api/orders`;
  const body: Record<string, unknown> = {
    marketId: payload.marketId,
    outcomeIndex: payload.outcomeIndex,
    side: payload.side,
    type: "MARKET",
    quantity: payload.quantity,
    agentId: payload.agentId,
    userSignature: userSignature, // Always include signature if available
  };
  if (payload.chainKey != null && payload.chainKey !== CHAIN_KEY_MAIN) {
    body.chainKey = payload.chainKey;
  } else {
    // Always include chainKey for agent orders
    body.chainKey = CHAIN_KEY_MAIN;
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
  pendingReason: "NO_WALLET" | "INSUFFICIENT_BALANCE" | "INSUFFICIENT_POSITION",
  reason?: string
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
      tradeReason: reason?.slice(0, 2000) ?? "no reason provided",
    },
  });
  console.log(`Pending trade created: ${pendingReason} (${side} qty=${quantity})`);
}

async function executeAgentLoop(job: Job<AgentJobPayload>): Promise<void> {
  const { marketId, agentId, simulationId = null, chainKey = CHAIN_KEY_MAIN } = job.data;
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

  // Store full AI reasoning in AgentReasoning table
  try {
    const modelSettings = agent.modelSettings as { model?: string } | null;
    const modelUsed = modelSettings?.model || "gemini-2.0-flash";
    
    await prisma.agentReasoning.create({
      data: {
        agentId,
        marketId,
        model: modelUsed,
        userContext: decision.prompt || `Market: ${market.name}\nOutcomes: ${outcomes.join(", ")}\nCurrent Positions: ${currentPositions.length} positions`,
        reasoning: decision.reason || "No reasoning provided",
        response: decision.fullResponse || JSON.stringify({
          action: decision.action,
          outcomeIndex: decision.outcomeIndex,
          quantity: decision.quantity,
          reason: decision.reason,
          nextFollowUpInMs: decision.nextFollowUpInMs
        }),
        actionTaken: decision.action,
        tradeReason: decision.reason?.slice(0, 2000) || "No reason provided",
        promptTokens: 0, // TODO: Track actual token usage
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      },
    });
    console.log(`Stored AI reasoning for market ${marketId}, action: ${decision.action}`);
  } catch (error) {
    console.error("Failed to store AI reasoning:", error);
    // Don't fail the whole process if reasoning storage fails
  }

  // Create/update position based on agent decision BEFORE order submission
  const marketContext = {
    marketName: market.name,
    outcomes,
    agentName: agent.name,
    personaSummary: personaSummary ?? agent.persona?.slice(0, 500),
    model: modelSettings?.model,
    simulationContext,
    currentPositions,
  };

  try {
    await createOrUpdateAgentPosition({
      agentId,
      marketId,
      decision,
      marketContext,
      chainKey,
    });
  } catch (err) {
    console.error(`Failed to create/update position for agent ${agentId}, market ${marketId}:`, err);
    // Continue with order submission even if position creation fails
  }

  if (decision.action === "skip") {
    console.log(`Decision: skip. ${decision.reason ?? ""}`);
    const followUpMs = decision.nextFollowUpInMs ?? DEFAULT_FOLLOW_UP_AFTER_SKIP_MS;
    const nextRun = new Date(Date.now() + followUpMs);
    await prisma.agentEnqueuedMarket.updateMany({
      where: { agentId, marketId, simulationId: simulationId ?? null },
      data: {
        status: "DISCARDED",
        // discardReason: decision.reason?.slice(0, 2000) ?? null,
        // tradeReason: decision.reason?.slice(0, 2000) ?? "no reason provided",
        discardReason: decision.reason,
        tradeReason: decision.reason,
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
    await createPendingTrade(agentId, marketId, outcomeIndex, side, quantity, "NO_WALLET", decision.reason);
    return;
  }

  const qty = new Decimal(quantity);
  if (side === "ASK") {
    const longForOutcome = positions
      .filter((p) => p.outcomeIndex === outcomeIndex && p.side === "LONG")
      .reduce((sum, p) => sum.plus(p.collateralLocked.toString()), new Decimal(0));
    if (longForOutcome.lt(qty)) {
      await createPendingTrade(agentId, marketId, outcomeIndex, side, quantity, "INSUFFICIENT_POSITION", decision.reason);
      return;
    }
  } else {
    const balanceStr = await getAgentBalanceForChain(agentId, chainKey);
    const balance = new Decimal(balanceStr ?? "0");
    if (balance.lt(qty)) {
      await createPendingTrade(agentId, marketId, outcomeIndex, side, quantity, "INSUFFICIENT_BALANCE", decision.reason);
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
      data: {
        status: "TRADED",
        nextRunAt: nextRun,
        tradeReason: decision.reason?.slice(0, 2000) ?? "no reason provided",
      },
    });
    void syncAgentBalanceFromBackend(agentId, chainKey);
  } else {
    console.error(`Order failed: status=${result.status} body=${JSON.stringify(result.body)}`);
    await prisma.agentEnqueuedMarket.updateMany({
      where: { agentId, marketId, simulationId: simulationId ?? null },
      data: {
        tradeReason: decision.reason?.slice(0, 2000) ?? "no reason provided",
        discardReason: `Order failed (${result.status}): ${JSON.stringify(result.body)}`.slice(0, 2000),
      },
    });
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