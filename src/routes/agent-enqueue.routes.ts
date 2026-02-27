import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { enqueueAgentPrediction, enqueueAgentPredictionNow } from "../workers/queue.js";
import { getPrismaClient } from "../lib/prisma.js";
import { requireAgentOwnerOrApiKeyById, requireUserOrApiKey, requireApiKeyOnly } from "../lib/permissions.js";
import { CHAIN_KEY_MAIN } from "../types/agent-chain.js";
import { isAgentChainKey } from "../types/agent-chain.js";

interface EnqueueBody {
  marketId: string;
  agentId: string;
  /** Trading place: "main" or "tenderly" (simulate). Default main. */
  chainKey?: string;
}

export async function registerAgentEnqueueRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: EnqueueBody }>("/api/agent/enqueue", async (req: FastifyRequest<{ Body: EnqueueBody }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const { marketId, agentId, chainKey: rawChainKey } = req.body ?? {};
    if (!marketId || !agentId) {
      return reply.code(400).send({ error: "marketId and agentId required" });
    }
    const chainKey = rawChainKey != null && isAgentChainKey(rawChainKey) ? rawChainKey : CHAIN_KEY_MAIN;
    if (!(await requireAgentOwnerOrApiKeyById(req, reply, agentId))) return;
    const prisma = getPrismaClient();
    const [market, agent] = await Promise.all([
      prisma.market.findUnique({ where: { id: marketId } }),
      prisma.agent.findUnique({ where: { id: agentId } }),
    ]);
    if (!market) return reply.code(404).send({ error: "Market not found" });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const jobId = await enqueueAgentPrediction({ marketId, agentId, chainKey });
    await prisma.agentEnqueuedMarket.upsert({
      where: { agentId_marketId: { agentId, marketId } },
      create: { agentId, marketId, chainKey },
      update: { chainKey },
    });
    return reply.send({ jobId });
  });

  app.delete<{ Body: EnqueueBody }>("/api/agent/enqueue", async (req: FastifyRequest<{ Body: EnqueueBody }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const { marketId, agentId } = req.body ?? {};
    if (!marketId || !agentId) {
      return reply.code(400).send({ error: "marketId and agentId required" });
    }
    if (!(await requireAgentOwnerOrApiKeyById(req, reply, agentId))) return;
    const prisma = getPrismaClient();
    await prisma.agentEnqueuedMarket.deleteMany({
      where: { agentId, marketId },
    });
    return reply.code(204).send();
  });

  /** POST /api/agent/:id/trigger - Manually trigger analysis for all enqueued markets (one-off jobs run soon). */
  app.post<{ Params: { id: string }; Body?: { chainKey?: string } }>("/api/agent/:id/trigger", async (req: FastifyRequest<{ Params: { id: string }; Body?: { chainKey?: string } }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const agentId = req.params.id?.trim();
    if (!agentId) return reply.code(400).send({ error: "Agent id required" });
    if (!(await requireAgentOwnerOrApiKeyById(req, reply, agentId))) return;
    const bodyChainKey = req.body?.chainKey != null && isAgentChainKey(req.body.chainKey) ? req.body.chainKey : undefined;
    const prisma = getPrismaClient();
    const rows = await prisma.agentEnqueuedMarket.findMany({
      where: { agentId },
      select: { marketId: true, chainKey: true },
    });
    const jobIds: string[] = [];
    for (const row of rows) {
      const chainKey = bodyChainKey ?? (isAgentChainKey(row.chainKey) ? row.chainKey : CHAIN_KEY_MAIN);
      const jobId = await enqueueAgentPredictionNow({ agentId, marketId: row.marketId, chainKey });
      jobIds.push(jobId);
    }
    return reply.send({ triggered: jobIds.length, jobIds });
  });

  /** POST /api/agent/trigger-all - Cron-only: enqueue one-off analysis for all enqueued markets (all agents). Requires API key. */
  app.post("/api/agent/trigger-all", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireApiKeyOnly(req, reply)) return;
    const prisma = getPrismaClient();
    const now = new Date();
    const rows = await prisma.agentEnqueuedMarket.findMany({
      where: {
        status: { in: ["PENDING", "TRADED"] },
        OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      },
      select: { agentId: true, marketId: true, chainKey: true },
    });
    const jobIds: string[] = [];
    for (const row of rows) {
      const chainKey = isAgentChainKey(row.chainKey) ? row.chainKey : CHAIN_KEY_MAIN;
      const jobId = await enqueueAgentPredictionNow({ agentId: row.agentId, marketId: row.marketId, chainKey });
      jobIds.push(jobId);
    }
    return reply.send({ triggered: jobIds.length, jobIds });
  });
}
