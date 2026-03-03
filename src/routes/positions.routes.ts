import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getPrismaClient } from "../lib/prisma.js";
import { config } from "../config/index.js";
import { broadcastMarketUpdate, MARKET_UPDATE_REASON } from "../lib/broadcast-market.js";
import { requireUserOrApiKey, requirePositionOwnerOrApiKey } from "../lib/permissions.js";
import {
  positionCreateSchema,
  positionUpdateSchema,
  positionQuerySchema,
  type PositionCreateInput,
  type PositionUpdateInput,
  type PositionQueryInput,
} from "../schemas/position.schema.js";
import { Prisma } from "@prisma/client";

function serializePosition(position: Prisma.PositionGetPayload<{}>) {
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
    const { marketId, userId, agentId, address, status, chainKey, includeLatestReason, limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    // const hasOwnerFilter = userId ?? agentId ?? address;
    // const platformAddr = config.platformLiquidityAddress?.trim();
    const chainWhere =
      chainKey === "main"
        ? { OR: [{ chainKey: "main" }, { chainKey: null }] }
        : { chainKey: "tenderly" };
    const where = {
      ...(marketId ? { marketId } : {}),
      ...(userId ? { userId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(address ? { address } : {}),
      ...(status ? { status } : {}),
      ...chainWhere,
      // ...(!hasOwnerFilter && platformAddr ? { address: { not: platformAddr } } : {}),
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

    let reasonByMarket: Map<string, string> = new Map();
    if (includeLatestReason && agentId && positions.length > 0) {
      const marketIds = [...new Set(positions.map((p) => p.marketId))];
      const reasons = await prisma.agentReasoning.findMany({
        where: { agentId, marketId: { in: marketIds } },
        orderBy: { createdAt: "desc" },
        select: { marketId: true, reasoning: true, actionTaken: true },
      });
      for (const r of reasons) {
        if (!r.marketId || reasonByMarket.has(r.marketId)) continue;
        const brief =
          (r.actionTaken?.trim().slice(0, 120) ?? null) ||
          (r.reasoning?.trim().slice(0, 120) ?? null) ||
          null;
        if (brief) reasonByMarket.set(r.marketId, brief);
      }
    }

    return reply.send({
      data: positions.map((position) => {
        const out = {
          ...serializePosition(position),
          market: position.market,
          ...(includeLatestReason && agentId && reasonByMarket.get(position.marketId)
            ? { lastReason: reasonByMarket.get(position.marketId) }
            : {}),
        };
        return out;
      }),
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
    await broadcastMarketUpdate({
      marketId: position.marketId,
      reason: MARKET_UPDATE_REASON.POSITION,
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
    await broadcastMarketUpdate({
      marketId: position.marketId,
      reason: MARKET_UPDATE_REASON.POSITION,
    });
    return reply.send({ ...serializePosition(position), market: position.market });
  });

  app.delete("/api/positions/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!(await requirePositionOwnerOrApiKey(req, reply))) return;
    const prisma = getPrismaClient();
    const position = await prisma.position.findUnique({
      where: { id: req.params.id },
      select: { marketId: true },
    });
    await prisma.position.delete({ where: { id: req.params.id } }).catch(() => null);
    if (position) {
      await broadcastMarketUpdate({
        marketId: position.marketId,
        reason: MARKET_UPDATE_REASON.POSITION,
      });
    }
    return reply.code(204).send();
  });
}
