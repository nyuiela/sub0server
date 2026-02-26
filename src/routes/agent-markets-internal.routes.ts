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
  onchainMarketCreatedBatchSchema,
  agentMarketsQuerySchema,
  type OnchainMarketCreatedInput,
  type OnchainMarketCreatedBatchInput,
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

async function createMarketFromOnchainResult(
  body: OnchainMarketCreatedInput
): Promise<{ market: ReturnType<typeof serializeMarket>; createMarketTxHash: string }> {
  const prisma = getPrismaClient();
  const existing = await prisma.market.findUnique({
    where: { conditionId: body.questionId },
  });
  if (existing) {
    throw Object.assign(new Error("Market with this conditionId already exists"), {
      code: "CONFLICT" as const,
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
  return {
    market: serializeMarket(market),
    createMarketTxHash: body.createMarketTxHash,
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
      try {
        const { market, createMarketTxHash } = await createMarketFromOnchainResult(
          parsed.data as OnchainMarketCreatedInput
        );
        return reply.code(201).send({ ...market, createMarketTxHash });
      } catch (err) {
        if (err && typeof err === "object" && (err as { code?: string }).code === "CONFLICT") {
          return reply.code(409).send({
            error: (err as Error).message,
            marketId: (err as { marketId?: string }).marketId,
          });
        }
        throw err;
      }
    }
  );

  app.post(
    "/api/internal/markets/onchain-created-batch",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const parsed = onchainMarketCreatedBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const batch = parsed.data as OnchainMarketCreatedBatchInput;
      const results: { questionId: string; createMarketTxHash: string; market?: unknown; error?: string }[] = [];
      for (const body of batch.markets) {
        try {
          const { market, createMarketTxHash } = await createMarketFromOnchainResult(body);
          results.push({ questionId: body.questionId, createMarketTxHash, market });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const conflict = err && typeof err === "object" && (err as { code?: string }).code === "CONFLICT";
          results.push({
            questionId: body.questionId,
            createMarketTxHash: body.createMarketTxHash,
            error: msg,
            ...(conflict && { marketId: (err as { marketId?: string }).marketId }),
          });
        }
      }
      return reply.code(200).send({ created: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, results });
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
      try {
        const { market, createMarketTxHash } = await createMarketFromOnchainResult(
          parsed.data as OnchainMarketCreatedInput
        );
        return reply.code(201).send({ ...market, createMarketTxHash });
      } catch (err) {
        if (err && typeof err === "object" && (err as { code?: string }).code === "CONFLICT") {
          return reply.code(409).send({
            error: (err as Error).message,
            marketId: (err as { marketId?: string }).marketId,
          });
        }
        throw err;
      }
    }
  );

  app.post(
    "/api/cre/markets/onchain-created-batch",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const parsed = onchainMarketCreatedBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
      }
      const batch = parsed.data as OnchainMarketCreatedBatchInput;
      const results: { questionId: string; createMarketTxHash: string; market?: unknown; error?: string }[] = [];
      for (const body of batch.markets) {
        try {
          const { market, createMarketTxHash } = await createMarketFromOnchainResult(body);
          results.push({ questionId: body.questionId, createMarketTxHash, market });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ questionId: body.questionId, createMarketTxHash: body.createMarketTxHash, error: msg });
        }
      }
      return reply.code(200).send({ created: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, results });
    }
  );
}
