/**
 * Agent-driven market creation flow:
 * - /api/internal/*: require API key (CRE or cron).
 * - /api/cre/*: no auth; for CRE workflow only (e.g. Docker). Expose only to trusted network.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { getPrismaClient } from "../lib/prisma.js";
import { broadcastMarketUpdate, MARKET_UPDATE_REASON } from "../lib/broadcast-market.js";
import { createPlatformPositionsForMarket } from "../services/platform-positions.service.js";
import { generateAgentMarkets } from "../services/agent-market-creation.service.js";
import { config } from "../config/index.js";
import {
  onchainMarketCreatedSchema,
  agentMarketsQuerySchema,
  type OnchainMarketCreatedInput,
  type AgentMarketsQueryInput,
} from "../schemas/agent-markets.schema.js";

function serializeMarket(market: {
  id: string;
  name: string;
  creatorAddress: string;
  volume: { toString(): string };
  context: string | null;
  resolutionDate: Date;
  oracleAddress: string;
  status: string;
  collateralToken: string;
  conditionId: string;
  platform?: string;
  liquidity?: { toString(): string } | null;
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
  };
}

export async function registerAgentMarketsInternalRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get(
    "/api/internal/agent-markets",
    async (
      req: FastifyRequest<{ Querystring: AgentMarketsQueryInput }>,
      reply: FastifyReply
    ) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const parsed = agentMarketsQuerySchema.safeParse(req.query);
      const count = parsed.success ? parsed.data.count ?? config.agentMarketsPerJob : config.agentMarketsPerJob;
      try {
        const payloads = await generateAgentMarkets(count);
        return reply.send({ data: payloads, count: payloads.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.warn({ err }, "agent-markets generation failed");
        return reply.code(500).send({ error: "Agent market generation failed", details: msg });
      }
    }
  );

  app.post(
    "/api/internal/markets/onchain-created",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const parsed = onchainMarketCreatedSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const body = parsed.data as OnchainMarketCreatedInput;
      const prisma = getPrismaClient();
      const existing = await prisma.market.findUnique({
        where: { conditionId: body.questionId },
      });
      if (existing) {
        return reply.code(409).send({
          error: "Market with this conditionId already exists",
          marketId: existing.id,
        });
      }

      const resolutionDate = new Date(Date.now() + body.duration * 1000);
      const outcomes =
        body.outcomeSlotCount === 2
          ? ["Yes", "No"]
          : Array.from({ length: body.outcomeSlotCount }, (_, i) => `Outcome ${i + 1}`);

      const market = await prisma.market.create({
        data: {
          name: body.question,
          creatorAddress: body.creatorAddress,
          context: null,
          outcomes: outcomes as object,
          resolutionDate,
          oracleAddress: body.oracle,
          collateralToken: config.defaultCollateralToken,
          conditionId: body.questionId,
          platform: "NATIVE",
          agentSource: body.agentSource ?? null,
        },
      });

      const outcomeCount = outcomes.length;
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

      return reply.code(201).send({
        ...serializeMarket(market),
        createMarketTxHash: body.createMarketTxHash,
      });
    }
  );

  app.get(
    "/api/cre/agent-markets",
    async (
      req: FastifyRequest<{ Querystring: AgentMarketsQueryInput }>,
      reply: FastifyReply
    ) => {
      const parsed = agentMarketsQuerySchema.safeParse(req.query);
      const count = parsed.success ? parsed.data.count ?? config.agentMarketsPerJob : config.agentMarketsPerJob;
      try {
        const payloads = await generateAgentMarkets(count);
        return reply.send({ data: payloads, count: payloads.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.warn({ err }, "cre/agent-markets generation failed");
        return reply.code(500).send({ error: "Agent market generation failed", details: msg });
      }
    }
  );

  app.post(
    "/api/cre/markets/onchain-created",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const parsed = onchainMarketCreatedSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const body = parsed.data as OnchainMarketCreatedInput;
      const prisma = getPrismaClient();
      const existing = await prisma.market.findUnique({
        where: { conditionId: body.questionId },
      });
      if (existing) {
        return reply.code(409).send({
          error: "Market with this conditionId already exists",
          marketId: existing.id,
        });
      }

      const resolutionDate = new Date(Date.now() + body.duration * 1000);
      const outcomes =
        body.outcomeSlotCount === 2
          ? ["Yes", "No"]
          : Array.from({ length: body.outcomeSlotCount }, (_, i) => `Outcome ${i + 1}`);

      const market = await prisma.market.create({
        data: {
          name: body.question,
          creatorAddress: body.creatorAddress,
          context: null,
          outcomes: outcomes as object,
          resolutionDate,
          oracleAddress: body.oracle,
          collateralToken: config.defaultCollateralToken,
          conditionId: body.questionId,
          platform: "NATIVE",
          agentSource: body.agentSource ?? null,
        },
      });

      const outcomeCount = outcomes.length;
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

      return reply.code(201).send({
        ...serializeMarket(market),
        createMarketTxHash: body.createMarketTxHash,
      });
    }
  );
}
