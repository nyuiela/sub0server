import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPrismaClient } from "../lib/prisma.js";
import {
  agentStrategyCreateSchema,
  agentStrategyUpdateSchema,
  type AgentStrategyCreateInput,
  type AgentStrategyUpdateInput,
} from "../schemas/strategy.schema.js";

export async function registerStrategyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/strategies/agent/:agentId", async (req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const strategy = await prisma.agentStrategy.findUnique({
      where: { agentId: req.params.agentId },
      include: { agent: { select: { id: true, name: true } } },
    });
    if (!strategy) return reply.code(404).send({ error: "Strategy not found" });
    return reply.send(strategy);
  });

  app.post("/api/strategies", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const parsed = agentStrategyCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const agent = await prisma.agent.findUnique({ where: { id: parsed.data.agentId } });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    const existing = await prisma.agentStrategy.findUnique({ where: { agentId: parsed.data.agentId } });
    if (existing) return reply.code(409).send({ error: "Agent already has a strategy" });
    const strategy = await prisma.agentStrategy.create({
      data: parsed.data,
      include: { agent: { select: { id: true, name: true } } },
    });
    return reply.code(201).send(strategy);
  });

  app.patch("/api/strategies/agent/:agentId", async (req: FastifyRequest<{ Params: { agentId: string }; Body: unknown }>, reply: FastifyReply) => {
    const parsed = agentStrategyUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const strategy = await prisma.agentStrategy
      .update({
        where: { agentId: req.params.agentId },
        data: parsed.data,
        include: { agent: { select: { id: true, name: true } } },
      })
      .catch(() => null);
    if (!strategy) return reply.code(404).send({ error: "Strategy not found" });
    return reply.send(strategy);
  });

  app.delete("/api/strategies/agent/:agentId", async (req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    await prisma.agentStrategy.delete({ where: { agentId: req.params.agentId } }).catch(() => null);
    return reply.code(204).send();
  });
}
