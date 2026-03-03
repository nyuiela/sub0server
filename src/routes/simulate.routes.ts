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
import { getX402Config } from "../x402/config.js";
import { computeSimulatePriceUsdc, usdcToAtomic } from "../x402/pricing.js";
import { paySimulateWithAgent } from "../services/agent-x402-pay.service.js";
import { MarketStatus } from "@prisma/client";

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

  /** GET /api/simulate/payment-config - x402 payment chain for simulation (Base Sepolia or Base mainnet). Auth required. */
  app.get("/api/simulate/payment-config", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(req);
    if (!user?.userId) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    const x402 = getX402Config();
    return reply.send({
      paymentRequired: x402.enabled,
      paymentChainId: x402.chainId,
    });
  });

  /** GET /api/simulations - List simulations for the current user (for Settings > Simulations). */
  app.get("/api/simulations", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = requireUser(req);
    if (!user?.userId) {
      return reply.code(401).send({ error: "Authentication required" });
    }
    const prisma = getPrismaClient();
    const list = await prisma.simulation.findMany({
      where: { ownerId: user.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        agentId: true,
        dateRangeStart: true,
        dateRangeEnd: true,
        maxMarkets: true,
        durationMinutes: true,
        status: true,
        createdAt: true,
        agent: { select: { name: true } },
        _count: { select: { enqueuedMarkets: true } },
      },
    });
    return reply.send({
      simulations: list.map((s) => ({
        id: s.id,
        agentId: s.agentId,
        agentName: s.agent.name,
        dateRangeStart: s.dateRangeStart.toISOString(),
        dateRangeEnd: s.dateRangeEnd.toISOString(),
        maxMarkets: s.maxMarkets,
        durationMinutes: s.durationMinutes,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        enqueuedCount: s._count.enqueuedMarkets,
      })),
    });
  });

  /** GET /api/simulations/:id - One simulation with enqueued markets (for Settings > Simulations > detail). */
  app.get(
    "/api/simulations/:id",
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const user = requireUser(req);
      if (!user?.userId) {
        return reply.code(401).send({ error: "Authentication required" });
      }
      const id = req.params.id?.trim() ?? "";
      if (!id) return reply.code(400).send({ error: "Simulation id required" });
      const prisma = getPrismaClient();
      const sim = await prisma.simulation.findFirst({
        where: { id, ownerId: user.userId },
        select: {
          id: true,
          agentId: true,
          dateRangeStart: true,
          dateRangeEnd: true,
          maxMarkets: true,
          durationMinutes: true,
          status: true,
          createdAt: true,
          agent: { select: { name: true } },
          enqueuedMarkets: {
            select: {
              marketId: true,
              status: true,
              discardReason: true,
              market: { select: { id: true, name: true, status: true } },
            },
          },
        },
      });
      if (!sim) return reply.code(404).send({ error: "Simulation not found" });
      return reply.send({
        id: sim.id,
        agentId: sim.agentId,
        agentName: sim.agent.name,
        dateRangeStart: sim.dateRangeStart.toISOString(),
        dateRangeEnd: sim.dateRangeEnd.toISOString(),
        maxMarkets: sim.maxMarkets,
        durationMinutes: sim.durationMinutes,
        status: sim.status,
        createdAt: sim.createdAt.toISOString(),
        markets: sim.enqueuedMarkets.map((e) => ({
          marketId: e.marketId,
          marketName: e.market?.name,
          marketStatus: e.market?.status,
          status: e.status,
          discardReason: e.discardReason ?? undefined,
        })),
      });
    }
  );

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
      const agentId = req.query.agentId?.trim() ?? "";
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

  /** POST /api/simulate/start - Start simulation: discover markets in date range, enqueue for agent (tenderly), trigger analysis. Agent will only use info within the date range (as-of simulation). Body may include maxMarkets (cap, default 100, max 500) and durationMinutes (for client-side timer). */
  app.post(
    "/api/simulate/start",
    async (
      req: FastifyRequest<{
        Body: {
          agentId?: string;
          dateRange?: { start?: string; end?: string };
          maxMarkets?: number;
          durationMinutes?: number;
        };
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
      const rawMax = req.body?.maxMarkets;
      const rawDuration = req.body?.durationMinutes;
      const maxMarketsNum =
        typeof rawMax === "number" && Number.isFinite(rawMax)
          ? rawMax
          : typeof rawMax === "string"
            ? Number(rawMax)
            : NaN;
      const maxMarketsForCap =
        Number.isFinite(maxMarketsNum) && maxMarketsNum > 0
          ? Math.min(Math.floor(maxMarketsNum), 500)
          : 50;
      const durationNum =
        typeof rawDuration === "number" && Number.isFinite(rawDuration)
          ? rawDuration
          : typeof rawDuration === "string"
            ? Number(rawDuration)
            : NaN;
      const durationMinutes =
        Number.isFinite(durationNum) && durationNum > 0
          ? Math.max(1, Math.floor(durationNum))
          : 60;
      const x402Config = getX402Config();
      if (x402Config.enabled && x402Config.receiverAddress?.trim()) {
        const amountUsdc = computeSimulatePriceUsdc(maxMarketsForCap, durationMinutes);
        const amountAtomic = usdcToAtomic(amountUsdc);
        const payResult = await paySimulateWithAgent(agentId, amountAtomic);
        if (!payResult.ok) {
          return reply.code(400).send({ error: payResult.error });
        }
      }
      const marketsInRange: { id: string; status: MarketStatus; agentReasons?: { tradeReason: string }[] }[] = await prisma.market.findMany({
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
        take: maxMarketsForCap,
        select: { id: true, status: true, agentReasons: { select: { agentId: true, tradeReason: true } } },
      });

      const simulation = await prisma.simulation.create({
        data: {
          ownerId: agent.ownerId,
          agentId,
          dateRangeStart: rangeStart,
          dateRangeEnd: rangeEnd,
          maxMarkets: maxMarketsForCap,
          durationMinutes,
        },
      });

      const jobIds: string[] = [];
      for (const market of marketsInRange) {
        await prisma.agentEnqueuedMarket.create({
          data: {
            agentId,
            marketId: market.id,
            simulationId: simulation.id,
            chainKey: CHAIN_KEY_TENDERLY,
            simulateDateRangeStart: rangeStart,
            simulateDateRangeEnd: rangeEnd,
            tradeReason: market.tradeReason ?? undefined,
          },
        });
        const jobId = await enqueueAgentPredictionNow({
          agentId,
          marketId: market.id,
          simulationId: simulation.id,
          chainKey: CHAIN_KEY_TENDERLY,
        });
        jobIds.push(jobId);
      }

      return reply.send({
        simulationId: simulation.id,
        enqueued: marketsInRange.length,
        jobIds,
      });
    }
  );

  /** POST /api/simulate/stop - Mark simulation as COMPLETED (timer ended) or CANCELLED (user stopped). Keeps Settings list in sync. */
  app.post(
    "/api/simulate/stop",
    async (
      req: FastifyRequest<{ Body: { simulationId?: string; cancelled?: boolean } }>,
      reply: FastifyReply
    ) => {
      const user = requireUser(req);
      if (!user?.userId) {
        return reply.code(401).send({ error: "Authentication required" });
      }
      const simulationId = req.body?.simulationId?.trim();
      if (!simulationId) {
        return reply.code(400).send({ error: "simulationId is required" });
      }
      const cancelled = Boolean(req.body?.cancelled);
      const prisma = getPrismaClient();
      const sim = await prisma.simulation.findFirst({
        where: { id: simulationId, ownerId: user.userId },
        select: { id: true, status: true },
      });
      if (!sim) {
        return reply.code(404).send({ error: "Simulation not found" });
      }
      if (sim.status !== "RUNNING") {
        return reply.send({ ok: true, status: sim.status });
      }
      const newStatus = cancelled ? "CANCELLED" : "COMPLETED";
      await prisma.simulation.update({
        where: { id: simulationId },
        data: { status: newStatus },
      });
      return reply.send({ ok: true, status: newStatus });
    }
  );

  /** DELETE /api/simulations/:id - Remove a simulation and its enqueued markets (cascade). Owner only. */
  app.delete(
    "/api/simulations/:id",
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ) => {
      const user = requireUser(req);
      if (!user?.userId) {
        return reply.code(401).send({ error: "Authentication required" });
      }
      const id = req.params.id?.trim();
      if (!id) return reply.code(400).send({ error: "Simulation id required" });
      const prisma = getPrismaClient();
      const sim = await prisma.simulation.findFirst({
        where: { id, ownerId: user.userId },
        select: { id: true },
      });
      if (!sim) return reply.code(404).send({ error: "Simulation not found" });
      await prisma.simulation.delete({ where: { id } });
      return reply.code(204).send();
    }
  );
}
