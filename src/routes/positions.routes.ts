import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPrismaClient } from "../lib/prisma.js";
import { requireUserOrApiKey, requirePositionOwnerOrApiKey } from "../lib/permissions.js";
import {
  positionCreateSchema,
  positionUpdateSchema,
  positionQuerySchema,
  type PositionCreateInput,
  type PositionUpdateInput,
  type PositionQueryInput,
} from "../schemas/position.schema.js";

function serializePosition(position: {
  id: string;
  marketId: string;
  userId: string | null;
  agentId: string | null;
  address: string;
  tokenAddress: string;
  outcomeIndex: number;
  side: string;
  status: string;
  avgPrice: { toString(): string };
  collateralLocked: { toString(): string };
  isAmm: boolean;
  contractPositionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...position,
    avgPrice: position.avgPrice.toString(),
    collateralLocked: position.collateralLocked.toString(),
  };
}

export async function registerPositionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/positions", async (req: FastifyRequest<{ Querystring: PositionQueryInput }>, reply: FastifyReply) => {
    const parsed = positionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { marketId, userId, agentId, address, status, limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    const where = {
      ...(marketId ? { marketId } : {}),
      ...(userId ? { userId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(address ? { address } : {}),
      ...(status ? { status } : {}),
    };
    const [positions, total] = await Promise.all([
      prisma.position.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: { market: { select: { id: true, name: true, conditionId: true } } },
      }),
      prisma.position.count({ where }),
    ]);
    return reply.send({
      data: positions.map((p) => ({ ...serializePosition(p), market: p.market })),
      total,
      limit,
      offset,
    });
  });

  app.get("/api/positions/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const position = await prisma.position.findUnique({
      where: { id: req.params.id },
      include: { market: true, user: { select: { id: true, address: true } }, agent: { select: { id: true, name: true } } },
    });
    if (!position) return reply.code(404).send({ error: "Position not found" });
    return reply.send({
      ...serializePosition(position),
      market: position.market,
      user: position.user,
      agent: position.agent,
    });
  });

  app.post("/api/positions", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const parsed = positionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({ where: { id: parsed.data.marketId } });
    if (!market) return reply.code(404).send({ error: "Market not found" });
    if (parsed.data.userId) {
      const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
      if (!user) return reply.code(404).send({ error: "User not found" });
    }
    if (parsed.data.agentId) {
      const agent = await prisma.agent.findUnique({ where: { id: parsed.data.agentId } });
      if (!agent) return reply.code(404).send({ error: "Agent not found" });
    }
    const position = await prisma.position.create({
      data: {
        ...parsed.data,
        avgPrice: parsed.data.avgPrice,
        collateralLocked: parsed.data.collateralLocked,
      },
      include: { market: { select: { id: true, name: true } } },
    });
    return reply.code(201).send({ ...serializePosition(position), market: position.market });
  });

  app.patch("/api/positions/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply: FastifyReply) => {
    if (!(await requirePositionOwnerOrApiKey(req, reply))) return;
    const parsed = positionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const position = await prisma.position
      .update({
        where: { id: req.params.id },
        data: parsed.data,
        include: { market: { select: { id: true, name: true } } },
      })
      .catch(() => null);
    if (!position) return reply.code(404).send({ error: "Position not found" });
    return reply.send({ ...serializePosition(position), market: position.market });
  });

  app.delete("/api/positions/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!(await requirePositionOwnerOrApiKey(req, reply))) return;
    const prisma = getPrismaClient();
    await prisma.position.delete({ where: { id: req.params.id } }).catch(() => null);
    return reply.code(204).send();
  });
}
