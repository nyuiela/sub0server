/**
 * Agent-driven market creation flow:
 * - /api/internal/*: require API key (CRE or cron).
 * - /api/cre/*: no auth; for CRE workflow only (e.g. Docker). Expose only to trusted network.
 *
 * Onchain-created callbacks (CRE notifies backend after createMarket):
 * - Single: POST .../onchain-created (one market per request). Used when CRE fetches via GET (HTTP cap).
 * - Batch:  POST .../onchain-created-batch (body: { markets: [...] }). Used when backend sends markets in request body; CRE sends one batch with all results. Every callback item is applied; if getMarket is not yet visible we still store questionId+createMarketTxHash and the pending poll fills conditionId later.
 */

import type { Hex } from "viem";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { getPrismaClient } from "../lib/prisma.js";
import { broadcastMarketUpdate, MARKET_UPDATE_REASON } from "../lib/broadcast-market.js";
import { createPlatformPositionsForMarket } from "../services/platform-positions.service.js";
import { generateAgentMarkets } from "../services/agent-market-creation.service.js";
import { getMarketFromChain } from "../services/cre-pending-markets.js";
import { stripQuestionUniqueSuffix } from "../lib/cre-question-unique-suffix.js";
import { getOutcomePositionIds } from "../services/conditional-tokens.service.js";
import { seedMarketLiquidityOnChain } from "../services/seed-market-liquidity.service.js";
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
  conditionId: string | null;
  questionId: string | null;
  createMarketTxHash?: string | null;
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

const GET_MARKET_RETRY_MS = 3_000;
const GET_MARKET_RETRIES = 5;

async function getMarketFromChainWithRetry(
  questionId: string
): Promise<Awaited<ReturnType<typeof getMarketFromChain>>> {
  for (let i = 0; i < GET_MARKET_RETRIES; i++) {
    const result = await getMarketFromChain(questionId);
    if (result) return result;
    if (i < GET_MARKET_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, GET_MARKET_RETRY_MS));
    }
  }
  return null;
}

async function createMarketFromOnchainResult(
  body: OnchainMarketCreatedInput
): Promise<{ market: ReturnType<typeof serializeMarket>; createMarketTxHash: string }> {
  const prisma = getPrismaClient();

  const chainMarket = await getMarketFromChainWithRetry(body.questionId);

  if (body.marketId) {
    const draft = await prisma.market.findUnique({
      where: { id: body.marketId },
    });
    if (draft && draft.questionId == null) {
      if (!chainMarket) {
        await prisma.market.update({
          where: { id: body.marketId },
          data: {
            questionId: body.questionId,
            createMarketTxHash: body.createMarketTxHash,
          },
        });
        const updated = await prisma.market.findUnique({
          where: { id: body.marketId },
        });
        if (updated) {
          return {
            market: serializeMarket(updated),
            createMarketTxHash: body.createMarketTxHash,
          };
        }
      }
    }
    if (draft && draft.questionId == null && chainMarket) {
      const conditionId = chainMarket.conditionId;
      const collateralToken =
        config.defaultCollateralToken?.trim() &&
        config.defaultCollateralToken !== "0x0000000000000000000000000000000000000000"
          ? config.defaultCollateralToken
          : "0x0ecdaB3BfcA91222b162A624D893bF49ec16ddBE";
      const outcomeCount = chainMarket.outcomeSlotCount;
      const outcomePositionIds = await getOutcomePositionIds(conditionId, collateralToken, outcomeCount);
      if (outcomePositionIds == null) {
        throw new Error("Could not get CT outcome position IDs for draft update");
      }
      const updated = await prisma.market.update({
        where: { id: body.marketId },
        data: {
          conditionId,
          questionId: body.questionId,
          createMarketTxHash: body.createMarketTxHash,
          outcomePositionIds: outcomePositionIds as object,
        },
      });
      await createPlatformPositionsForMarket(
        updated.id,
        outcomeCount,
        updated.collateralToken,
        outcomePositionIds
      );
      const questionIdHex = (body.questionId.startsWith("0x")
        ? body.questionId
        : `0x${body.questionId}`) as Hex;
      const seeded = await seedMarketLiquidityOnChain(questionIdHex, config.platformSeedAmountUsdcRaw);
      const initialVolume = seeded ? rawUsdcToDecimalString(config.platformSeedAmountUsdcRaw) : "0";
      const initialLiquidity = initialVolume;
      await prisma.market.update({
        where: { id: updated.id },
        data: { volume: initialVolume, liquidity: initialLiquidity },
      });
      await broadcastMarketUpdate({
        marketId: updated.id,
        reason: MARKET_UPDATE_REASON.CREATED,
        volume: initialVolume,
      });
      const refreshed = await prisma.market.findUnique({ where: { id: updated.id } });
      return {
        market: serializeMarket(refreshed ?? updated),
        createMarketTxHash: body.createMarketTxHash,
      };
    }
  }

  if (!chainMarket) {
    throw new Error(
      "Market not found on chain (getMarket). Ensure CHAIN_RPC_URL is set and points to the same chain CRE used; market may need a few seconds to be visible."
    );
  }
  const conditionId = chainMarket.conditionId;

  const existing = await prisma.market.findFirst({
    where: { conditionId },
  });
  if (existing) {
    const withHash = await prisma.market.update({
      where: { id: existing.id },
      data: { createMarketTxHash: body.createMarketTxHash },
    }).catch(() => existing);
    return {
      market: serializeMarket(withHash),
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

  const questionIdHex = (body.questionId.startsWith("0x")
    ? body.questionId
    : `0x${body.questionId}`) as Hex;
  const seeded = await seedMarketLiquidityOnChain(questionIdHex, config.platformSeedAmountUsdcRaw);
  const initialVolume = seeded ? rawUsdcToDecimalString(config.platformSeedAmountUsdcRaw) : "0";
  const initialLiquidity = initialVolume;

  const market = await prisma.market.create({
    data: {
      name: stripQuestionUniqueSuffix(chainMarket.question),
      creatorAddress: chainMarket.owner,
      context: null,
      outcomes: outcomes as object,
      outcomePositionIds: outcomePositionIds as object,
      resolutionDate,
      oracleAddress: chainMarket.oracle,
      collateralToken,
      conditionId,
      questionId: body.questionId,
      createMarketTxHash: body.createMarketTxHash,
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
          req.log.warn({ err, questionId: body.questionId, marketId: body.marketId }, "onchain-created-batch item failed");
          results.push({
            questionId: body.questionId,
            createMarketTxHash: body.createMarketTxHash,
            ...(body.seedTxHash ? { seedTxHash: body.seedTxHash } : {}),
            error: msg,
          });
        }
      }
      const created = results.filter((r) => !r.error).length;
      const failed = results.filter((r) => r.error).length;
      if (failed > 0) req.log.warn({ created, failed, results }, "onchain-created-batch had failures");
      return reply.code(200).send({ created, failed, results });
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
          req.log.warn({ err, questionId: body.questionId, marketId: body.marketId }, "onchain-created-batch item failed");
          results.push({
            questionId: body.questionId,
            createMarketTxHash: body.createMarketTxHash,
            ...(body.seedTxHash ? { seedTxHash: body.seedTxHash } : {}),
            error: msg,
          });
        }
      }
      const created = results.filter((r) => !r.error).length;
      const failed = results.filter((r) => r.error).length;
      if (failed > 0) req.log.warn({ created, failed, results }, "onchain-created-batch had failures");
      return reply.code(200).send({ created, failed, results });
    }
  );
}
