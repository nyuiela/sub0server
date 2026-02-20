import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../lib/prisma.js";
import {
  marketCreateSchema,
  marketUpdateSchema,
  marketQuerySchema,
  type MarketCreateInput,
  type MarketUpdateInput,
  type MarketQueryInput,
} from "../schemas/market.schema.js";

function serializeMarket(market: {
  id: string;
  name: string;
  creatorAddress: string;
  volume: { toString(): string };
  context: string | null;
  outcomes: unknown;
  sourceUrl: string | null;
  resolutionDate: Date;
  oracleAddress: string;
  status: string;
  collateralToken: string;
  conditionId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...market,
    volume: market.volume.toString(),
    resolutionDate: market.resolutionDate.toISOString(),
  };
}

export async function registerMarketRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/markets", async (req: FastifyRequest<{ Querystring: MarketQueryInput }>, reply: FastifyReply) => {
    const parsed = marketQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { status, creatorAddress, limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    const where = { ...(status ? { status } : {}), ...(creatorAddress ? { creatorAddress } : {}) };
    const [markets, total] = await Promise.all([
      prisma.market.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.market.count({ where }),
    ]);
    return reply.send({
      data: markets.map(serializeMarket),
      total,
      limit,
      offset,
    });
  });

  app.get("/api/markets/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({
      where: { id: req.params.id },
      include: { positions: { take: 10 }, orders: { take: 5 } },
    });
    if (!market) return reply.code(404).send({ error: "Market not found" });
    return reply.send({
      ...serializeMarket(market),
      positions: market.positions,
      orders: market.orders,
    });
  });

  app.get("/api/markets/condition/:conditionId", async (req: FastifyRequest<{ Params: { conditionId: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({
      where: { conditionId: req.params.conditionId },
    });
    if (!market) return reply.code(404).send({ error: "Market not found" });
    return reply.send(serializeMarket(market));
  });

  app.post("/api/markets", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    const parsed = marketCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const prisma = getPrismaClient();
    const existing = await prisma.market.findUnique({ where: { conditionId: parsed.data.conditionId } });
    if (existing) return reply.code(409).send({ error: "Market with this conditionId already exists" });
    const market = await prisma.market.create({
      data: {
        name: parsed.data.name,
        creatorAddress: parsed.data.creatorAddress,
        context: parsed.data.context ?? undefined,
        outcomes: parsed.data.outcomes as object,
        sourceUrl: parsed.data.sourceUrl ?? undefined,
        resolutionDate: new Date(parsed.data.resolutionDate),
        oracleAddress: parsed.data.oracleAddress,
        collateralToken: parsed.data.collateralToken,
        conditionId: parsed.data.conditionId,
      },
    });
    return reply.code(201).send(serializeMarket(market));
  });

  app.patch("/api/markets/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply: FastifyReply) => {
    const parsed = marketUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const raw = parsed.data;
    const data: Prisma.MarketUpdateInput = {};
    if (raw.name !== undefined) data.name = raw.name;
    if (raw.context !== undefined) data.context = raw.context;
    if (raw.outcomes !== undefined) data.outcomes = raw.outcomes as Prisma.InputJsonValue;
    if (raw.sourceUrl !== undefined) data.sourceUrl = raw.sourceUrl;
    if (raw.resolutionDate !== undefined) data.resolutionDate = new Date(raw.resolutionDate);
    if (raw.oracleAddress !== undefined) data.oracleAddress = raw.oracleAddress;
    if (raw.status !== undefined) data.status = raw.status;
    const prisma = getPrismaClient();
    const market = await prisma.market.update({
      where: { id: req.params.id },
      data,
    }).catch(() => null);
    if (!market) return reply.code(404).send({ error: "Market not found" });
    return reply.send(serializeMarket(market));
  });

  app.delete("/api/markets/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    await prisma.market.delete({ where: { id: req.params.id } }).catch(() => null);
    return reply.code(204).send();
  });
}
