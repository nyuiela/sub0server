import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../lib/prisma.js";
import { broadcastMarketUpdate, MARKET_UPDATE_REASON } from "../lib/broadcast-market.js";
import { requireUserOrApiKey, requireMarketCreatorOrApiKey } from "../lib/permissions.js";
import { requireUser, requireApiKey } from "../lib/auth.js";
import {
  marketCreateSchema,
  marketUpdateSchema,
  marketQuerySchema,
  type MarketCreateInput,
  type MarketUpdateInput,
  type MarketQueryInput,
} from "../schemas/market.schema.js";
import {
  getMarketStatsBatch,
  getMarketPositionIds,
  getOrderBookStatsForMarket,
  type MarketStatsRow,
} from "../services/market-stats.service.js";
import { getMarketHolders, getMarketTraders } from "../services/activities.service.js";
import { createPlatformPositionsForMarket } from "../services/platform-positions.service.js";
import { getMarketPrices, getMarketQuote } from "../services/lmsr-prices.service.js";
import {
  marketPricesQuerySchema,
  marketQuoteQuerySchema,
  candlesQuerySchema,
  type MarketPricesQueryInput,
  type MarketQuoteQueryInput,
  type CandlesQueryInput,
} from "../schemas/price.schema.js";
import { getMarketCandles } from "../services/candles.service.js";

function serializeMarket(market: {
  id: string;
  name: string;
  creatorAddress: string;
  volume: { toString(): string };
  context: string | null;
  imageUrl?: string | null;
  outcomes: unknown;
  sourceUrl: string | null;
  resolutionDate: Date;
  oracleAddress: string;
  status: string;
  collateralToken: string;
  conditionId: string;
  platform?: string;
  liquidity?: { toString(): string } | null;
  confidence?: number | null;
  pnl?: { toString(): string } | null;
  createdAt: Date;
  updatedAt: Date;
  agentSource?: string | null;
}) {
  const { agentSource: _omit, ...rest } = market;
  return {
    ...rest,
    volume: market.volume.toString(),
    resolutionDate: market.resolutionDate.toISOString(),
    liquidity: market.liquidity?.toString() ?? null,
    pnl: market.pnl?.toString() ?? null,
  };
}

function withListStats(
  serialized: ReturnType<typeof serializeMarket>,
  stats: MarketStatsRow
) {
  return {
    ...serialized,
    totalVolume: stats.totalVolume,
    uniqueStakersCount: stats.uniqueStakers,
    lastTradeAt: stats.lastTradeAt?.toISOString() ?? null,
    totalTrades: stats.totalTrades,
    agentsEngagingCount: stats.agentsEngaging,
    newsCount: stats.newsCount,
  };
}

export async function registerMarketRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/markets", async (req: FastifyRequest<{ Querystring: MarketQueryInput }>, reply: FastifyReply) => {
    const parsed = marketQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { status, creatorAddress, platform, limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    const where: Prisma.MarketWhereInput = {
      ...(status ? { status } : {}),
      ...(creatorAddress ? { creatorAddress } : {}),
      ...(platform ? { platform } : {}),
    };
    const [markets, total] = await Promise.all([
      prisma.market.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      }),
      prisma.market.count({ where }),
    ]);
    const marketIds = markets.map((m) => m.id);
    const statsMap = await getMarketStatsBatch(marketIds);
    const data = markets.map((m) => {
      const stats = statsMap.get(m.id) ?? {
        marketId: m.id,
        totalVolume: "0",
        lastTradeAt: null,
        totalTrades: 0,
        uniqueStakers: 0,
        agentsEngaging: 0,
        newsCount: 0,
      };
      const orderBook = getOrderBookStatsForMarket(m.id);
      const base = withListStats(serializeMarket(m), stats as MarketStatsRow);
      return {
        ...base,
        activeOrderCount: orderBook.activeOrderCount,
        orderBookBidLiquidity: orderBook.bidLiquidity,
        orderBookAskLiquidity: orderBook.askLiquidity,
      };
    });
    return reply.send({
      data,
      total,
      limit,
      offset,
    });
  });

  app.get("/api/markets/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({
      where: { id: req.params.id },
      include: {
        positions: { take: 10 },
        orders: { take: 20, orderBy: { createdAt: "desc" } },
      },
    });
    if (!market) return reply.code(404).send({ error: "Market not found" });
    const [statsMap, positionIds, orderBook] = await Promise.all([
      getMarketStatsBatch([market.id]),
      getMarketPositionIds(market.id),
      Promise.resolve(getOrderBookStatsForMarket(market.id)),
    ]);
    const stats = statsMap.get(market.id);
    const base = serializeMarket(market);
    const response = {
      ...base,
      totalVolume: stats?.totalVolume ?? base.volume,
      uniqueStakersCount: stats?.uniqueStakers ?? 0,
      lastTradeAt: stats?.lastTradeAt?.toISOString() ?? null,
      totalTrades: stats?.totalTrades ?? 0,
      activeOrderCount: orderBook.activeOrderCount,
      orderBookBidLiquidity: orderBook.bidLiquidity,
      orderBookAskLiquidity: orderBook.askLiquidity,
      liquidity: base.liquidity,
      agentsEngagingCount: stats?.agentsEngaging ?? 0,
      positionIds,
      pnl: base.pnl,
      confidence: "confidence" in market ? (market as { confidence?: number | null }).confidence ?? null : null,
      newsCount: stats?.newsCount ?? 0,
      orderBookSnapshot: orderBook.snapshot,
      positions: market.positions,
      orders: market.orders,
    };
    return reply.send(response);
  });

  app.get("/api/markets/:id/holders", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!market) return reply.code(404).send({ error: "Market not found" });
    const holders = await getMarketHolders(market.id);
    return reply.send({ data: holders });
  });

  app.get("/api/markets/:id/traders", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!market) return reply.code(404).send({ error: "Market not found" });
    const traders = await getMarketTraders(market.id);
    return reply.send({ data: traders });
  });

  app.get(
    "/api/markets/:id/prices/quote",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Querystring: MarketQuoteQueryInput;
      }>,
      reply: FastifyReply
    ) => {
      const parsed = marketQuoteQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }
      const quote = await getMarketQuote(
        req.params.id,
        parsed.data.outcomeIndex,
        parsed.data.side,
        parsed.data.quantity
      );
      if (!quote) {
        return reply.code(404).send({
          error: "Market not found or quote unavailable",
          message: "Check market id and outcomeIndex, or insufficient liquidity for sell",
        });
      }
      return reply.send(quote);
    }
  );

  app.get(
    "/api/markets/:id/prices",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Querystring: MarketPricesQueryInput;
      }>,
      reply: FastifyReply
    ) => {
      const parsed = marketPricesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }
      const prices = await getMarketPrices(req.params.id, parsed.data.quantity);
      if (!prices) return reply.code(404).send({ error: "Market not found" });
      return reply.send(prices);
    }
  );

  app.get(
    "/api/markets/:id/candles",
    async (
      req: FastifyRequest<{
        Params: { id: string };
        Querystring: CandlesQueryInput;
      }>,
      reply: FastifyReply
    ) => {
      const parsed = candlesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }
      const prisma = getPrismaClient();
      const market = await prisma.market.findUnique({
        where: { id: req.params.id },
        select: { id: true },
      });
      if (!market) return reply.code(404).send({ error: "Market not found" });
      const candles = await getMarketCandles(req.params.id, parsed.data.resolution, {
        outcomeIndex: parsed.data.outcomeIndex,
        limit: parsed.data.limit,
        from: parsed.data.from != null ? new Date(parsed.data.from) : undefined,
        to: parsed.data.to != null ? new Date(parsed.data.to) : undefined,
      });
      return reply.send({ marketId: req.params.id, candles });
    }
  );

  app.get("/api/markets/condition/:conditionId", async (req: FastifyRequest<{ Params: { conditionId: string } }>, reply: FastifyReply) => {
    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({
      where: { conditionId: req.params.conditionId },
    });
    if (!market) return reply.code(404).send({ error: "Market not found" });
    const [statsMap] = await Promise.all([getMarketStatsBatch([market.id])]);
    const stats = statsMap.get(market.id);
    const base = serializeMarket(market);
    const withStats = stats
      ? withListStats(base, stats)
      : { ...base, totalVolume: base.volume, uniqueStakersCount: 0, lastTradeAt: null, totalTrades: 0, agentsEngagingCount: 0, newsCount: 0 };
    const orderBook = getOrderBookStatsForMarket(market.id);
    return reply.send({
      ...withStats,
      activeOrderCount: orderBook.activeOrderCount,
      orderBookBidLiquidity: orderBook.bidLiquidity,
      orderBookAskLiquidity: orderBook.askLiquidity,
    });
  });

  app.post("/api/markets", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const parsed = marketCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    if (!requireApiKey(req)) {
      const user = requireUser(req);
      if (user && parsed.data.creatorAddress?.toLowerCase() !== user.address.toLowerCase()) {
        return reply.code(403).send({ error: "Forbidden: creatorAddress must match your wallet" });
      }
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
        outcomePositionIds:
          parsed.data.outcomePositionIds != null && parsed.data.outcomePositionIds.length > 0
            ? (parsed.data.outcomePositionIds as object)
            : undefined,
        sourceUrl: parsed.data.sourceUrl ?? undefined,
        resolutionDate: new Date(parsed.data.resolutionDate),
        oracleAddress: parsed.data.oracleAddress,
        collateralToken: parsed.data.collateralToken,
        conditionId: parsed.data.conditionId,
        platform: parsed.data.platform ?? "NATIVE",
      },
    });
    const outcomes = market.outcomes as unknown[];
    const outcomeCount = Array.isArray(outcomes) ? outcomes.length : 0;
    const outcomePositionIds = market.outcomePositionIds as string[] | null;
    await createPlatformPositionsForMarket(
      market.id,
      outcomeCount,
      market.collateralToken,
      Array.isArray(outcomePositionIds) ? outcomePositionIds : null
    );
    await broadcastMarketUpdate({
      marketId: market.id,
      reason: MARKET_UPDATE_REASON.CREATED,
      volume: market.volume.toString(),
    });
    return reply.code(201).send(serializeMarket(market));
  });

  app.patch("/api/markets/:id", async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply: FastifyReply) => {
    if (!(await requireMarketCreatorOrApiKey(req, reply))) return;
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
    if (raw.platform !== undefined) data.platform = raw.platform;
    if (raw.liquidity !== undefined) data.liquidity = raw.liquidity;
    if (raw.confidence !== undefined) data.confidence = raw.confidence;
    if (raw.pnl !== undefined) data.pnl = raw.pnl;
    const prisma = getPrismaClient();
    const market = await prisma.market.update({
      where: { id: req.params.id },
      data,
    }).catch(() => null);
    if (!market) return reply.code(404).send({ error: "Market not found" });
    await broadcastMarketUpdate({
      marketId: market.id,
      reason: MARKET_UPDATE_REASON.UPDATED,
      volume: market.volume.toString(),
    });
    return reply.send(serializeMarket(market));
  });

  app.delete("/api/markets/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!(await requireMarketCreatorOrApiKey(req, reply))) return;
    const marketId = req.params.id;
    const prisma = getPrismaClient();
    await prisma.market.delete({ where: { id: marketId } }).catch(() => null);
    await broadcastMarketUpdate({ marketId, reason: MARKET_UPDATE_REASON.DELETED });
    return reply.code(204).send();
  });
}
