import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { enqueueAgentPrediction } from "../workers/queue.js";
import { getPrismaClient } from "../lib/prisma.js";
import { requireAgentOwnerOrApiKeyById, requireUserOrApiKey } from "../lib/permissions.js";

interface EnqueueBody {
  marketId: string;
  agentId: string;
}

export async function registerAgentEnqueueRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: EnqueueBody }>("/api/agent/enqueue", async (req: FastifyRequest<{ Body: EnqueueBody }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const { marketId, agentId } = req.body ?? {};
    if (!marketId || !agentId) {
      return reply.code(400).send({ error: "marketId and agentId required" });
    }
    if (!(await requireAgentOwnerOrApiKeyById(req, reply, agentId))) return;
    const prisma = getPrismaClient();
    const [market, agent] = await Promise.all([
      prisma.market.findUnique({ where: { id: marketId } }),
      prisma.agent.findUnique({ where: { id: agentId } }),
    ]);
    if (!market) return reply.code(404).send({ error: "Market not found" });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const jobId = await enqueueAgentPrediction({ marketId, agentId });
    return reply.send({ jobId });
  });
}
