import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { enqueueAgentPrediction, enqueueAgentPredictionNow } from "../workers/queue.js";
import { getPrismaClient } from "../lib/prisma.js";
import { requireAgentOwnerOrApiKeyById, requireUserOrApiKey, requireApiKeyOnly } from "../lib/permissions.js";
import { CHAIN_KEY_MAIN } from "../types/agent-chain.js";
import { isAgentChainKey } from "../types/agent-chain.js";
import { runTriggerAll } from "../services/trigger-all.service.js";

interface EnqueueBody {
  marketId: string;
  agentId: string;
  /** Trading place: "main" or "tenderly" (simulate). Default main. */
  chainKey?: string;
  /** When set, row is scoped to this simulation (Simulate section only). Omit = main. */
  simulationId?: string | null;
}

export async function registerAgentEnqueueRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: EnqueueBody }>("/api/agent/enqueue", async (req: FastifyRequest<{ Body: EnqueueBody }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const { marketId, agentId, chainKey: rawChainKey, simulationId: bodySimulationId } = req.body ?? {};
    if (!marketId || !agentId) {
      return reply.code(400).send({ error: "marketId and agentId required" });
    }
    if (!(await requireAgentOwnerOrApiKeyById(req, reply, agentId))) return;
    const prisma = getPrismaClient();

    const isSimulate = bodySimulationId != null && bodySimulationId !== "";
    const simulationId = isSimulate ? bodySimulationId : null;
    const chainKey =
      isSimulate ? "tenderly" as const
      : (rawChainKey != null && isAgentChainKey(rawChainKey) ? rawChainKey : CHAIN_KEY_MAIN);

    if (isSimulate) {
      const user = requireUser(req);
      if (!user?.userId) {
        return reply.code(401).send({ error: "Authentication required to add to simulate" });
      }
      const sim = await prisma.simulation.findFirst({
        where: { id: bodySimulationId!, ownerId: user.userId },
        select: { id: true },
      });
      if (!sim) {
        return reply.code(404).send({ error: "Simulation not found or not yours" });
      }
    }

    const [market, agent] = await Promise.all([
      prisma.market.findUnique({ where: { id: marketId } }),
      prisma.agent.findUnique({ where: { id: agentId } }),
    ]);
    if (!market) return reply.code(404).send({ error: "Market not found" });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });

    const jobId = await enqueueAgentPrediction({
      marketId,
      agentId,
      chainKey,
      ...(simulationId ? { simulationId } : {}),
    });
    const existing = await prisma.agentEnqueuedMarket.findFirst({
      where: { agentId, marketId, simulationId },
    });
    if (existing) {
      await prisma.agentEnqueuedMarket.update({
        where: { id: existing.id },
        data: { chainKey },
      });
    } else {
      await prisma.agentEnqueuedMarket.create({
        data: { agentId, marketId, simulationId, chainKey },
      });
    }
    return reply.send({ jobId });
  });

  app.delete<{ Body: EnqueueBody }>("/api/agent/enqueue", async (req: FastifyRequest<{ Body: EnqueueBody }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const { marketId, agentId, simulationId: bodySimulationId } = req.body ?? {};
    if (!marketId || !agentId) {
      return reply.code(400).send({ error: "marketId and agentId required" });
    }
    if (!(await requireAgentOwnerOrApiKeyById(req, reply, agentId))) return;
    const prisma = getPrismaClient();
    const simulationId = bodySimulationId != null && bodySimulationId !== "" ? bodySimulationId : null;
    await prisma.agentEnqueuedMarket.deleteMany({
      where: { agentId, marketId, simulationId },
    });
    return reply.code(204).send();
  });

  /** POST /api/agent/:id/trigger - Manually trigger analysis for enqueued markets. Main: omit simulationId. Simulate: pass simulationId to trigger only that run's markets. */
  app.post<{ Params: { id: string }; Body?: { chainKey?: string; simulationId?: string } }>("/api/agent/:id/trigger", async (req: FastifyRequest<{ Params: { id: string }; Body?: { chainKey?: string; simulationId?: string } }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const agentId = req.params.id?.trim();
    if (!agentId) return reply.code(400).send({ error: "Agent id required" });
    if (!(await requireAgentOwnerOrApiKeyById(req, reply, agentId))) return;
    const bodyChainKey = req.body?.chainKey != null && isAgentChainKey(req.body.chainKey) ? req.body.chainKey : undefined;
    const bodySimulationId = req.body?.simulationId?.trim() ?? null;
    const simulationId = bodySimulationId || null;
    const prisma = getPrismaClient();
    const rows = await prisma.agentEnqueuedMarket.findMany({
      where: { agentId, simulationId },
      select: { marketId: true, chainKey: true },
    });
    const jobIds: string[] = [];
    for (const row of rows) {
      const chainKey = bodyChainKey ?? (isAgentChainKey(row.chainKey) ? row.chainKey : CHAIN_KEY_MAIN);
      const jobId = await enqueueAgentPredictionNow({
        agentId,
        marketId: row.marketId,
        chainKey,
        ...(simulationId ? { simulationId } : {}),
      });
      jobIds.push(jobId);
    }
    return reply.send({ triggered: jobIds.length, jobIds });
  });

  /** POST /api/agent/trigger-all - Cron: (1) discovery + (2) enqueue due jobs for MAIN. Requires API key. Also run in-process when TRIGGER_ALL_CRON_ENABLED=true. */
  app.post("/api/agent/trigger-all", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireApiKeyOnly(req, reply)) return;
    const result = await runTriggerAll(req.log);
    return reply.send(result);
  });
}
