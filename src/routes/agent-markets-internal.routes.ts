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
import { getMarketFromChain } from "../services/cre-pending-markets.js";
import { getOutcomePositionIds } from "../services/conditional-tokens.service.js";
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

function rawUsdcToDecimalString(raw: bigint): string {
  const USDC_DECIMALS = 6;
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;
  const fracStr = fracPart.toString().padStart(USDC_DECIMALS, "0").slice(0, 8);
  return fracStr === "0".repeat(8) ? intPart.toString() : `${intPart}.${fracStr}`;
}

async function createMarketFromOnchainResult(
  body: OnchainMarketCreatedInput
): Promise<{ market: ReturnType<typeof serializeMarket>; createMarketTxHash: string }> {
  const prisma = getPrismaClient();

  const chainMarket = await getMarketFromChain(body.questionId);
  if (!chainMarket) {
    throw new Error("Market not found on chain (getMarket); create and seed first");
  }
  const conditionId = chainMarket.conditionId;

  const existing = await prisma.market.findUnique({
    where: { conditionId },
  });
  if (existing) {
    return {
      market: serializeMarket(existing),
      createMarketTxHash: body.createMarketTxHash,
    };
  }

  const collateralToken =
    config.defaultCollateralToken?.trim() &&
    config.defaultCollateralToken !== "0x0000000000000000000000000000000000000000"
      ? config.defaultCollateralToken
      : "0x0ecdaB3BfcA91222b162A624D893bF49ec16ddBE";
  const outcomeCount = chainMarket.outcomeSlotCount;
  const outcomePositionIds = await getOutcomePositionIds(conditionId, collateralToken, outcomeCount);
  if (outcomePositionIds == null) {
    throw new Error("Could not get CT outcome position IDs");
  }

  const resolutionDate = new Date(Date.now() + Number(chainMarket.duration) * 1000);
  const outcomes =
    outcomeCount === 2
      ? ["Yes", "No"]
      : Array.from({ length: outcomeCount }, (_, i) => `Outcome ${i + 1}`);

  const hasSeedTx = Boolean(body.seedTxHash?.trim());
  const initialVolume = hasSeedTx ? rawUsdcToDecimalString(config.platformSeedAmountUsdcRaw) : "0";
  const initialLiquidity = initialVolume;

  const market = await prisma.market.create({
    data: {
      name: chainMarket.question,
      creatorAddress: chainMarket.owner,
      context: null,
      outcomes: outcomes as object,
      outcomePositionIds: outcomePositionIds as object,
      resolutionDate,
      oracleAddress: chainMarket.oracle,
      collateralToken,
      conditionId,
      questionId: body.questionId,
      platform: "NATIVE",
      agentSource: body.agentSource ?? null,
      volume: initialVolume,
      liquidity: initialLiquidity,
    },
  });

  await createPlatformPositionsForMarket(
    market.id,
    outcomeCount,
    market.collateralToken,
    outcomePositionIds
  );

  await broadcastMarketUpdate({
    marketId: market.id,
    reason: MARKET_UPDATE_REASON.CREATED,
    volume: initialVolume,
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
        const body = parsed.data as OnchainMarketCreatedInput;
        const { market, createMarketTxHash } = await createMarketFromOnchainResult(body);
        const payload: Record<string, unknown> = { ...market, createMarketTxHash };
        if (body.seedTxHash) payload.seedTxHash = body.seedTxHash;
        return reply.code(201).send(payload);
      } catch (err) {
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
      const results: { questionId: string; createMarketTxHash: string; seedTxHash?: string; market?: unknown; error?: string }[] = [];
      for (const body of batch.markets) {
        try {
          const { market, createMarketTxHash } = await createMarketFromOnchainResult(body);
          results.push({
            questionId: body.questionId,
            createMarketTxHash,
            ...(body.seedTxHash ? { seedTxHash: body.seedTxHash } : {}),
            market,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            questionId: body.questionId,
            createMarketTxHash: body.createMarketTxHash,
            ...(body.seedTxHash ? { seedTxHash: body.seedTxHash } : {}),
            error: msg,
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
        const body = parsed.data as OnchainMarketCreatedInput;
        const { market, createMarketTxHash } = await createMarketFromOnchainResult(body);
        const payload: Record<string, unknown> = { ...market, createMarketTxHash };
        if (body.seedTxHash) payload.seedTxHash = body.seedTxHash;
        return reply.code(201).send(payload);
      } catch (err) {
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
      const results: { questionId: string; createMarketTxHash: string; seedTxHash?: string; market?: unknown; error?: string }[] = [];
      for (const body of batch.markets) {
        try {
          const { market, createMarketTxHash } = await createMarketFromOnchainResult(body);
          results.push({
            questionId: body.questionId,
            createMarketTxHash,
            ...(body.seedTxHash ? { seedTxHash: body.seedTxHash } : {}),
            market,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            questionId: body.questionId,
            createMarketTxHash: body.createMarketTxHash,
            ...(body.seedTxHash ? { seedTxHash: body.seedTxHash } : {}),
            error: msg,
          });
        }
      }
      return reply.code(200).send({ created: results.filter((r) => !r.error).length, failed: results.filter((r) => r.error).length, results });
    }
  );
}
