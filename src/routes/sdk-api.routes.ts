/**
 * SDK API routes that require agent auth (Bearer api_key).
 * Markets (list/detail) and quote signing for BYOA agents.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { getPrismaClient } from "../lib/prisma.js";
import { getAgentRegistrationModel } from "../lib/agent-registration-db.js";
import { requireAgent } from "../lib/auth.js";
import {
  getMarketStatsBatch,
  getOrderBookStatsForMarket,
  getMarketPositionIds,
  type MarketStatsRow,
} from "../services/market-stats.service.js";
import { signLMSRQuoteForAgent, isQuoteSigningConfigured } from "../services/sdk-quote-sign.service.js";
import { marketQuerySchema, type MarketQueryInput } from "../schemas/market.schema.js";

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
  conditionId: string | null;
  platform?: string;
  liquidity?: { toString(): string } | null;
  pnl?: { toString(): string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: market.id,
    name: market.name,
    creatorAddress: market.creatorAddress,
    volume: market.volume.toString(),
    context: market.context,
    imageUrl: market.imageUrl,
    outcomes: market.outcomes,
    sourceUrl: market.sourceUrl,
    resolutionDate: market.resolutionDate.toISOString(),
    oracleAddress: market.oracleAddress,
    status: market.status,
    collateralToken: market.collateralToken,
    conditionId: market.conditionId,
    platform: market.platform,
    liquidity: market.liquidity?.toString() ?? null,
    pnl: market.pnl?.toString() ?? null,
    createdAt: market.createdAt.toISOString(),
    updatedAt: market.updatedAt.toISOString(),
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

export async function registerSdkApiRoutes(app: FastifyInstance): Promise<void> {
  const requireAgentAuth = (req: FastifyRequest, reply: FastifyReply) => {
    const agent = requireAgent(req);
    if (!agent) {
      reply.code(401).send({ error: "Agent API key required (Bearer or x-api-key)" });
      return null;
    }
    return agent;
  };

  app.get("/api/sdk/markets", async (req: FastifyRequest<{ Querystring: MarketQueryInput }>, reply: FastifyReply) => {
    if (!requireAgentAuth(req, reply)) return;
    const parsed = marketQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }
    const { status, creatorAddress, platform, limit, offset } = parsed.data;
    const prisma = getPrismaClient();
    const where: Prisma.MarketWhereInput = {
      questionId: { not: null },
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
      return {
        ...withListStats(serializeMarket(m), stats as MarketStatsRow),
        activeOrderCount: orderBook.activeOrderCount,
        orderBookBidLiquidity: orderBook.bidLiquidity,
        orderBookAskLiquidity: orderBook.askLiquidity,
      };
    });
    return reply.send({ data, total, limit, offset });
  });

  app.get("/api/sdk/markets/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requireAgentAuth(req, reply)) return;
    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({
      where: { id: req.params.id },
      include: {
        positions: { take: 10 },
        orders: { take: 20, orderBy: { createdAt: "desc" } },
      },
    });
    if (!market) return reply.code(404).send({ error: "Market not found" });
    if (market.questionId == null) return reply.code(404).send({ error: "Market not found", message: "Market is not yet on-chain" });
    const [statsMap, positionIds, orderBook] = await Promise.all([
      getMarketStatsBatch([market.id]),
      getMarketPositionIds(market.id),
      Promise.resolve(getOrderBookStatsForMarket(market.id)),
    ]);
    const stats = statsMap.get(market.id);
    const base = serializeMarket(market);
    return reply.send({
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
      newsCount: stats?.newsCount ?? 0,
      orderBookSnapshot: orderBook.snapshot,
      positions: market.positions,
      orders: market.orders,
    });
  });

  app.post(
    "/api/sdk/quote",
    async (
      req: FastifyRequest<{
        Body: {
          questionId?: string;
          outcomeIndex?: number;
          buy?: boolean;
          quantity?: string;
          tradeCostUsdc?: string;
          nonce?: string;
          deadline?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const agent = requireAgent(req);
      if (!agent) {
        return reply.code(401).send({ error: "Agent API key required" });
      }
      if (!isQuoteSigningConfigured()) {
        return reply.code(503).send({ error: "Quote signing not configured" });
      }
      const b = req.body ?? {};
      const questionId = typeof b.questionId === "string" ? (b.questionId.startsWith("0x") ? b.questionId as `0x${string}` : `0x${b.questionId}` as `0x${string}`) : undefined;
      const outcomeIndex = typeof b.outcomeIndex === "number" ? b.outcomeIndex : undefined;
      const buy = typeof b.buy === "boolean" ? b.buy : undefined;
      const quantity = typeof b.quantity === "string" ? b.quantity : undefined;
      const tradeCostUsdc = typeof b.tradeCostUsdc === "string" ? b.tradeCostUsdc : undefined;
      const nonce = typeof b.nonce === "string" ? b.nonce : undefined;
      const deadline = typeof b.deadline === "string" ? b.deadline : undefined;
      if (!questionId || outcomeIndex === undefined || buy === undefined || !quantity || !tradeCostUsdc || !nonce || !deadline) {
        return reply.code(400).send({
          error: "Missing or invalid body: questionId, outcomeIndex, buy, quantity, tradeCostUsdc, nonce, deadline required",
        });
      }
      const agentReg = getAgentRegistrationModel();
      const reg = await agentReg.findUnique({
        where: { id: agent.registrationId },
        select: { encryptedPrivateKey: true },
      });
      if (!reg) {
        return reply.code(401).send({ error: "Registration not found" });
      }
      try {
        const signed = await signLMSRQuoteForAgent(reg.encryptedPrivateKey as string, {
          questionId,
          outcomeIndex,
          buy,
          quantity,
          tradeCostUsdc,
          nonce,
          deadline,
        });
        return reply.send(signed);
      } catch (err) {
        req.log.error(err);
        return reply.code(500).send({ error: "Quote signing failed" });
      }
    }
  );
}
