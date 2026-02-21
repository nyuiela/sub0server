import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../lib/prisma.js";
import { requireAgentOwnerOrApiKey, requireUserOrApiKey } from "../lib/permissions.js";
import { requireUser, requireApiKey } from "../lib/auth.js";
import {
  agentCreateSchema,
  agentUpdateSchema,
  agentQuerySchema,
  type AgentCreateInput,
  type AgentUpdateInput,
  type AgentQueryInput,
} from "../schemas/agent.schema.js";

function serializeAgent(agent: {
  id: string;
  ownerId: string;
  name: string;
  persona: string;
  publicKey: string;
  balance: { toString(): string };
  tradedAmount: { toString(): string };
  totalTrades: number;
  pnl: { toString(): string };
  status: string;
  modelSettings: unknown;
  templateId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...agent,
    balance: agent.balance.toString(),
    tradedAmount: agent.tradedAmount.toString(),
    pnl: agent.pnl.toString(),
  };
}

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/agents", async (req: FastifyRequest<{ Querystring: AgentQueryInput }>, reply: FastifyReply) => {
    const parsed = agentQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { ownerId, status, limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    const where = { ...(ownerId ? { ownerId } : {}), ...(status ? { status } : {}) };
    const [agents, total] = await Promise.all([
      prisma.agent.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { owner: { select: { id: true, address: true } }, strategy: true },
      }),
      prisma.agent.count({ where }),
    ]);
    return reply.send({
      data: agents.map((a) => ({ ...serializeAgent(a), owner: a.owner, strategy: a.strategy })),
      total,
      limit,
      offset,
    });
  });

  app.get("/api/agents/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const agent = await prisma.agent.findUnique({
      where: { id: req.params.id },
      include: { owner: true, strategy: true, template: true },
    });
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    return reply.send({
      ...serializeAgent(agent),
      owner: agent.owner,
      strategy: agent.strategy,
      template: agent.template,
    });
  });

  app.post("/api/agents", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const parsed = agentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    if (!requireApiKey(req)) {
      const user = requireUser(req);
      if (!user?.userId) return reply.code(403).send({ error: "User not found or not registered" });
      if (parsed.data.ownerId !== user.userId) return reply.code(403).send({ error: "Forbidden: can only create agent for yourself" });
    }
    const prisma = getPrismaClient();
    const owner = await prisma.user.findUnique({ where: { id: parsed.data.ownerId } });
    if (!owner) return reply.code(404).send({ error: "Owner not found" });
    const agent = await prisma.agent.create({
      data: {
        ownerId: parsed.data.ownerId,
        name: parsed.data.name,
        persona: parsed.data.persona,
        publicKey: parsed.data.publicKey,
        encryptedPrivateKey: parsed.data.encryptedPrivateKey,
        modelSettings: parsed.data.modelSettings as Prisma.InputJsonValue,
        templateId: parsed.data.templateId ?? undefined,
      },
      include: { owner: { select: { id: true, address: true } } },
    });
    return reply.code(201).send({ ...serializeAgent(agent), owner: agent.owner });
  });

  app.patch("/api/agents/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply: FastifyReply) => {
    if (!(await requireAgentOwnerOrApiKey(req, reply))) return;
    const parsed = agentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const raw = parsed.data;
    const data: Prisma.AgentUpdateInput = {};
    if (raw.name !== undefined) data.name = raw.name;
    if (raw.persona !== undefined) data.persona = raw.persona;
    if (raw.encryptedPrivateKey !== undefined) data.encryptedPrivateKey = raw.encryptedPrivateKey;
    if (raw.modelSettings !== undefined) data.modelSettings = raw.modelSettings as Prisma.InputJsonValue;
    if (raw.status !== undefined) data.status = raw.status;
    if (raw.templateId !== undefined) {
      data.template = raw.templateId === null
        ? { disconnect: true }
        : { connect: { id: raw.templateId } };
    }
    const prisma = getPrismaClient();
    const agent = await prisma.agent
      .update({
        where: { id: req.params.id },
        data,
        include: { owner: { select: { id: true, address: true } }, strategy: true },
      })
      .catch(() => null);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    return reply.send({ ...serializeAgent(agent), owner: agent.owner, strategy: agent.strategy });
  });

  app.delete("/api/agents/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!(await requireAgentOwnerOrApiKey(req, reply))) return;
    const prisma = getPrismaClient();
    await prisma.agent.delete({ where: { id: req.params.id } }).catch(() => null);
    return reply.code(204).send();
  });
}
