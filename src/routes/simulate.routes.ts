import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Decimal } from "decimal.js";
import { getPrismaClient } from "../lib/prisma.js";
import { requireUser } from "../lib/auth.js";
import { getRedisConnection } from "../lib/redis.js";
import { upsertAgentChainBalance } from "../lib/agent-chain-balance.js";
import { CHAIN_KEY_TENDERLY } from "../types/agent-chain.js";
import { enqueueAgentPredictionNow } from "../workers/queue.js";
import {
  getTenderlyChainConfig,
  checkFundingEligibility,
  fundSimulateWallet,
  getNativeBalance,
  getErc20Balance,
} from "../utils/tenderly/index.js";

const USDC_DECIMALS = 6;

const SIMULATE_FUND_KEY_PREFIX = "simulate-fund:";

function fundingKey(ownerId: string, agentId: string): string {
  return `${SIMULATE_FUND_KEY_PREFIX}${ownerId}:${agentId}`;
}

export async function registerSimulateRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/simulate/config - Public chain info for the simulate sandbox (chainId, name, explorer). Auth required. */
  app.get("/api/simulate/config", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(req);
    if (!user?.userId) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    const chain = getTenderlyChainConfig();
    if (!chain) {
      return reply.send({ configured: false });
    }
    return reply.send({
      configured: true,
      chainId: chain.chainId,
      name: chain.name,
      blockExplorerUrl: chain.blockExplorerUrl ?? undefined,
    });
  });

  /** GET /api/simulate/balance?agentId= - Simulate chain balance for agent wallet (native + USDC). */
  app.get(
    "/api/simulate/balance",
    async (
      req: FastifyRequest<{ Querystring: { agentId?: string } }>,
      reply: FastifyReply
    ) => {
      const user = requireUser(req);
      if (!user?.userId) {
        return reply.code(401).send({ error: "Authentication required" });
      }
      const agentId = req.query.agentId?.trim();
      if (!agentId) {
        return reply.code(400).send({ error: "agentId is required" });
      }
      const prisma = getPrismaClient();
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { ownerId: true, walletAddress: true },
      });
      if (!agent) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      if (agent.ownerId !== user.userId) {
        return reply.code(403).send({ error: "Forbidden: not your agent" });
      }
      const walletAddress = agent.walletAddress?.trim();
      if (!walletAddress) {
        return reply.code(400).send({
          error: "Agent has no wallet. Create a wallet first.",
          nativeWei: "0",
          usdcUnits: "0",
        });
      }
      const chain = getTenderlyChainConfig();
      if (!chain) {
        return reply.code(503).send({
          error: "Simulate chain is not configured",
          nativeWei: "0",
          usdcUnits: "0",
        });
      }
      try {
        const [nativeWei, usdcUnits] = await Promise.all([
          getNativeBalance(chain.rpcUrl, walletAddress),
          getErc20Balance(chain.rpcUrl, chain.usdcAddress, walletAddress),
        ]);
        const usdcDecimal = new Decimal(usdcUnits.toString()).div(
          Math.pow(10, USDC_DECIMALS)
        ).toFixed();
        await upsertAgentChainBalance(agentId, CHAIN_KEY_TENDERLY, usdcDecimal);
        return reply.send({
          nativeWei: nativeWei.toString(),
          usdcUnits: usdcUnits.toString(),
          chainId: chain.chainId,
          walletAddress,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return reply.code(502).send({
          error: "Failed to fetch balance",
          detail: message,
        });
      }
    }
  );

  /** GET /api/simulate/eligibility?agentId= - Whether user can request funding (first time or after cooldown). */
  app.get(
    "/api/simulate/eligibility",
    async (
      req: FastifyRequest<{ Querystring: { agentId?: string } }>,
      reply: FastifyReply
    ) => {
      const user = requireUser(req);
      if (!user?.userId) {
        return reply.code(401).send({ error: "Authentication required" });
      }
      const agentId = req.query.agentId?.trim();
      if (!agentId) {
        return reply.code(400).send({ error: "agentId is required" });
      }
      const prisma = getPrismaClient();
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { ownerId: true },
      });
      if (!agent) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      if (agent.ownerId !== user.userId) {
        return reply.code(403).send({ error: "Forbidden: not your agent" });
      }
      let lastRequestAt: number | null = null;
      try {
        const redis = await getRedisConnection();
        const key = fundingKey(agent.ownerId, agentId);
        const raw = await redis.get(key);
        if (raw != null) {
          const n = Number(raw);
          if (!Number.isNaN(n)) lastRequestAt = n;
        }
      } catch {
        // use in-memory only if Redis fails
      }
      const eligibility = checkFundingEligibility(
        agent.ownerId,
        agentId,
        lastRequestAt ?? undefined
      );
      return reply.send(eligibility);
    }
  );

  /** POST /api/simulate/fund - Fund agent wallet on simulate chain (0.1 ETH + 20_000 USDC). Once per week after first. */
  app.post(
    "/api/simulate/fund",
    async (
      req: FastifyRequest<{ Body: { agentId?: string } }>,
      reply: FastifyReply
    ) => {
      const user = requireUser(req);
      if (!user?.userId) {
        return reply.code(401).send({ error: "Authentication required" });
      }
      const agentId = req.body?.agentId?.trim();
      if (!agentId) {
        return reply.code(400).send({ error: "agentId is required" });
      }
      const prisma = getPrismaClient();
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { ownerId: true, walletAddress: true },
      });
      if (!agent) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      if (agent.ownerId !== user.userId) {
        return reply.code(403).send({ error: "Forbidden: not your agent" });
      }
      const walletAddress = agent.walletAddress?.trim();
      if (!walletAddress) {
        return reply.code(400).send({
          error: "Agent has no wallet. Create a wallet first.",
        });
      }
      let lastRequestAt: number | null = null;
      try {
        const redis = await getRedisConnection();
        const key = fundingKey(agent.ownerId, agentId);
        const raw = await redis.get(key);
        if (raw != null) {
          const n = Number(raw);
          if (!Number.isNaN(n)) lastRequestAt = n;
        }
      } catch {
        // continue with in-memory only
      }
      const eligibility = checkFundingEligibility(
        agent.ownerId,
        agentId,
        lastRequestAt ?? undefined
      );
      if (!eligibility.eligible) {
        return reply.code(429).send({
          error: eligibility.reason ?? "Funding not available",
          nextRequestAt: eligibility.nextRequestAt,
        });
      }
      const result = await fundSimulateWallet(
        walletAddress,
        agent.ownerId,
        agentId,
        { firstTime: eligibility.firstTime }
      );
      if (!result.success) {
        return reply.code(502).send({
          error: result.error ?? "Funding failed",
        });
      }
      try {
        const redis = await getRedisConnection();
        const key = fundingKey(agent.ownerId, agentId);
        await redis.set(key, Date.now().toString());
      } catch {
        // in-memory already updated by fundSimulateWallet
      }
      await upsertAgentChainBalance(agentId, CHAIN_KEY_TENDERLY, "20000");
      return reply.send({
        success: true,
        nativeTxHash: result.nativeTxHash,
        usdcTxHash: result.usdcTxHash,
      });
    }
  );

  /** POST /api/simulate/start - Start simulation: discover markets in date range, enqueue for agent (tenderly), trigger analysis. Agent will only use info within the date range (as-of simulation). */
  app.post(
    "/api/simulate/start",
    async (
      req: FastifyRequest<{
        Body: { agentId?: string; dateRange?: { start?: string; end?: string } };
      }>,
      reply: FastifyReply
    ) => {
      const user = requireUser(req);
      if (!user?.userId) {
        return reply.code(401).send({ error: "Authentication required" });
      }
      const agentId = req.body?.agentId?.trim();
      const dateRange = req.body?.dateRange;
      if (!agentId) {
        return reply.code(400).send({ error: "agentId is required" });
      }
      const startStr = dateRange?.start?.trim();
      const endStr = dateRange?.end?.trim();
      if (!startStr || !endStr) {
        return reply.code(400).send({
          error: "dateRange.start and dateRange.end are required (ISO date strings)",
        });
      }
      const rangeStart = new Date(startStr);
      const rangeEnd = new Date(endStr);
      if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
        return reply.code(400).send({ error: "Invalid dateRange dates" });
      }
      if (rangeStart > rangeEnd) {
        return reply.code(400).send({ error: "dateRange.start must be before dateRange.end" });
      }
      const prisma = getPrismaClient();
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { ownerId: true },
      });
      if (!agent) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      if (agent.ownerId !== user.userId) {
        return reply.code(403).send({ error: "Forbidden: not your agent" });
      }
      const marketsInRange = await prisma.market.findMany({
        where: {
          questionId: { not: null },
          OR: [
            {
              resolutionDate: { gte: rangeStart, lte: rangeEnd },
            },
            {
              createdAt: { lte: rangeEnd },
              resolutionDate: { gt: rangeEnd },
            },
          ],
        },
        orderBy: { resolutionDate: "desc" },
        take: 100,
        select: { id: true },
      });
      const jobIds: string[] = [];
      for (const m of marketsInRange) {
        await prisma.agentEnqueuedMarket.upsert({
          where: { agentId_marketId: { agentId, marketId: m.id } },
          create: {
            agentId,
            marketId: m.id,
            chainKey: CHAIN_KEY_TENDERLY,
            simulateDateRangeStart: rangeStart,
            simulateDateRangeEnd: rangeEnd,
          },
          update: {
            chainKey: CHAIN_KEY_TENDERLY,
            simulateDateRangeStart: rangeStart,
            simulateDateRangeEnd: rangeEnd,
            status: "PENDING",
            discardReason: null,
            nextRunAt: null,
          },
        });
        const jobId = await enqueueAgentPredictionNow({
          agentId,
          marketId: m.id,
          chainKey: CHAIN_KEY_TENDERLY,
        });
        jobIds.push(jobId);
      }
      return reply.send({
        enqueued: marketsInRange.length,
        jobIds,
      });
    }
  );
}
