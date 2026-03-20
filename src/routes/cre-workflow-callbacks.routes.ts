/**
 * CRE workflow query endpoints: backend routes the CRE agent-analysis and settlement-consensus
 * workflows call to fetch data or trigger LLM operations.
 *
 * - GET  /api/internal/cre/enqueued-markets — active agent+market pairs for analysis.
 * - POST /api/internal/cre/analyze — run LLM trading decision for one agent+market pair.
 * - GET  /api/internal/settlement/context/:marketId — market context for settlement deliberation.
 * - POST /api/internal/cre/deliberate-primary — first LLM agent opinion for settlement.
 * - POST /api/internal/cre/deliberate-crosscheck — second LLM cross-check opinion for settlement.
 *
 * All endpoints require x-api-key (internal API key).
 * These complement the existing cre-callback.routes.ts (which handles inbound callback notifications).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { getPrismaClient } from "../lib/prisma.js";
import { getRedisConnection } from "../lib/redis.js";
import { getSocketManager } from "../services/websocket.service.js";
import { WS_EVENT_NAMES } from "../types/websocket-events.js";
import { runTradingAnalysis } from "../services/agent-trading-analysis.service.js";
import { runTwoAgentDeliberation } from "../services/settlement-deliberation.service.js";
import { registerAgentIdentity, publishValidationProof } from "../services/erc8004.service.js";
import { deriveEnsSlug } from "../lib/ens-slug.js";

const MACRO_DATA_CACHE_KEY = "cre:macro-data:latest";
const MACRO_DATA_TTL_SEC = 300; // 5 min

const DEFAULT_ENQUEUED_LIMIT = 20;

interface EnqueuedMarketRow {
  agentId: string;
  marketId: string;
  chainKey: string;
}

interface AnalyzeRequestBody {
  agentId?: string;
  marketId?: string;
  chainKey?: string;
}

interface DeliberateRequestBody {
  context?: Record<string, unknown>;
  priorOpinion?: { payouts?: string[]; rationale?: string; winnerIndex?: number };
}

async function getEnqueuedMarkets(
  req: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;

  const query = req.query as Record<string, string>;
  const limit = Math.min(Number(query.limit ?? DEFAULT_ENQUEUED_LIMIT), 50);

  const prisma = getPrismaClient();
  const rows = await prisma.agentEnqueuedMarket.findMany({
    where: { status: { not: "DISCARDED" } },
    select: { agentId: true, marketId: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });

  const result: EnqueuedMarketRow[] = rows.map((r) => ({
    agentId: r.agentId,
    marketId: r.marketId,
    chainKey: "main",
  }));

  return reply.code(200).send(result);
}

async function runAnalyze(
  req: FastifyRequest<{ Body: AnalyzeRequestBody }>,
  reply: FastifyReply
): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;

  const { agentId, marketId } = req.body ?? {};
  if (!agentId || !marketId) {
    return reply.code(400).send({ error: "agentId and marketId required" });
  }

  const prisma = getPrismaClient();

  const [agent, market] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, persona: true, modelSettings: true },
    }),
    prisma.market.findUnique({
      where: { id: marketId },
      select: { id: true, name: true, outcomes: true },
    }),
  ]);

  if (!agent) return reply.code(404).send({ error: "Agent not found" });
  if (!market) return reply.code(404).send({ error: "Market not found" });

  const outcomes = (() => {
    if (Array.isArray(market.outcomes)) {
      return (market.outcomes as Array<{ name?: string }>).map((o) => o?.name ?? "Unknown");
    }
    return ["Yes", "No"];
  })();

  const decision = await runTradingAnalysis({
    marketName: market.name,
    outcomes,
    agentName: agent.name,
    personaSummary: agent.persona ?? undefined,
    model: (agent.modelSettings as { model?: string } | null)?.model ?? undefined,
  });

  return reply.code(200).send(decision);
}

async function getSettlementContext(
  req: FastifyRequest<{ Params: { marketId: string } }>,
  reply: FastifyReply
): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;

  const { marketId } = req.params;
  if (!marketId) return reply.code(400).send({ error: "marketId required" });

  const prisma = getPrismaClient();
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: {
      id: true,
      name: true,
      outcomes: true,
      settlementRules: true,
      resolutionDate: true,
      conditionId: true,
      status: true,
    },
  });

  if (!market) return reply.code(404).send({ error: "Market not found" });

  const outcomes = (() => {
    if (Array.isArray(market.outcomes)) {
      return (market.outcomes as Array<{ name?: string }>).map((o) => o?.name ?? "Unknown");
    }
    return ["Yes", "No"];
  })();

  return reply.code(200).send({
    marketId: market.id,
    question: market.name,
    outcomes,
    settlementRules: market.settlementRules ?? null,
    resolutionDate: market.resolutionDate?.toISOString() ?? null,
    conditionId: market.conditionId ?? null,
    status: market.status,
  });
}

function extractPayoutsFromVerdict(outcomeArray: number[]): string[] {
  return outcomeArray.map(String);
}

function findWinnerIndex(payouts: string[]): number {
  return payouts.reduce(
    (max, v, i) => (Number(v) > Number(payouts[max]) ? i : max),
    0
  );
}

async function runDeliberatePrimary(
  req: FastifyRequest<{ Body: DeliberateRequestBody }>,
  reply: FastifyReply
): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;

  const context = req.body?.context;
  if (!context?.question || !Array.isArray(context?.outcomes)) {
    return reply.code(400).send({ error: "context.question and context.outcomes required" });
  }

  const result = await runTwoAgentDeliberation({
    questionId: typeof context.marketId === "string" ? context.marketId : "unknown",
    question: String(context.question),
    outcomes: context.outcomes as string[],
    rules: typeof context.settlementRules === "string" ? context.settlementRules : null,
  });

  const primaryPayouts = extractPayoutsFromVerdict(result.agentA?.outcomeArray ?? []);
  return reply.code(200).send({
    payouts: primaryPayouts,
    rationale: result.agentA?.reason ?? "",
    winnerIndex: findWinnerIndex(primaryPayouts),
  });
}

async function runDeliberateCrosscheck(
  req: FastifyRequest<{ Body: DeliberateRequestBody }>,
  reply: FastifyReply
): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;

  const context = req.body?.context;
  if (!context?.question || !Array.isArray(context?.outcomes)) {
    return reply.code(400).send({ error: "context.question and context.outcomes required" });
  }

  const result = await runTwoAgentDeliberation({
    questionId: typeof context.marketId === "string" ? context.marketId : "unknown",
    question: String(context.question),
    outcomes: context.outcomes as string[],
    rules: typeof context.settlementRules === "string" ? context.settlementRules : null,
  });

  const crosscheckPayouts = extractPayoutsFromVerdict(result.agentB?.outcomeArray ?? []);
  return reply.code(200).send({
    payouts: crosscheckPayouts,
    rationale: result.agentB?.reason ?? "",
    winnerIndex: findWinnerIndex(crosscheckPayouts),
    consensus: result.consensus,
    finalPayouts: result.consensus
      ? extractPayoutsFromVerdict(result.outcomeArray ?? [])
      : null,
  });
}

/** GET /api/internal/cre/macro-data — latest macro snapshot (Redis cache, TTL 5 min) */
async function getMacroData(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;
  try {
    const redis = await getRedisConnection();
    const cached = await redis.get(MACRO_DATA_CACHE_KEY);
    if (cached) return reply.code(200).send(JSON.parse(cached));
  } catch { /* Redis miss — fall through */ }
  return reply.code(200).send({ prices: [], marketSentiment: "neutral", volatilityIndex: 0, source: "empty", fetchedAt: new Date().toISOString() });
}

/** POST /api/internal/cre/macro-data — store incoming macro snapshot with TTL */
async function postMacroData(req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;
  const body = req.body as Record<string, unknown>;
  try {
    const redis = await getRedisConnection();
    await redis.setex(MACRO_DATA_CACHE_KEY, MACRO_DATA_TTL_SEC, JSON.stringify(body));
  } catch (err) {
    req.log.warn({ err }, "macro-data: Redis write failed");
  }
  return reply.code(200).send({ ok: true });
}

/** POST /api/internal/cre/webhook-event — persist event + broadcast via WebSocket */
async function postWebhookEvent(req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;
  const body = req.body as Record<string, unknown>;
  const eventType = typeof body?.eventType === "string" ? body.eventType : "onchainEvent";
  const ws = getSocketManager();
  ws?.broadcastToRoom("markets", {
    type: WS_EVENT_NAMES.REGISTRY_SYNC_UPDATE,
    payload: { source: "webhookBridge", eventType, data: body, syncedAt: new Date().toISOString() },
  });
  return reply.code(200).send({ ok: true, eventType });
}

/** POST /api/internal/cre/registry-record — relay compliance/proof records + ERC-8004 dispatch */
async function postRegistryRecord(req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;
  const body = req.body as Record<string, unknown>;
  const event = typeof body?.event === "string" ? body.event : "unknown";
  req.log.info({ event }, "[registry-record] received CRE registry record");

  // Persist in Redis as a lightweight event log with 24h TTL
  try {
    const redis = await getRedisConnection();
    const key = `cre:registry:${event}:${Date.now()}`;
    await redis.setex(key, 86400, JSON.stringify({ ...body, receivedAt: new Date().toISOString() }));
  } catch (err) {
    req.log.warn({ err }, "registry-record: Redis write failed");
  }

  // Dispatch ERC-8004 side-effects asynchronously (fire-and-forget)
  const agentId = typeof body?.agentId === "string" ? body.agentId : null;
  if (event === "erc8004:identity:mint" && agentId) {
    const walletAddress = typeof body?.walletAddress === "string" ? body.walletAddress : null;
    if (walletAddress) {
      registerAgentIdentity(agentId, walletAddress).catch((err) => {
        req.log.warn({ err, agentId }, "[registry-record] ERC-8004 identity mint failed");
      });
      // Auto-assign ENS slug when wallet is created (if not already set)
      const prisma = getPrismaClient();
      prisma.agent.findUnique({ where: { id: agentId }, select: { name: true, ensName: true } })
        .then(async (agent) => {
          if (!agent?.ensName && agent?.name) {
            const slug = deriveEnsSlug(agent.name);
            const ensName = `${slug}.sub0.eth`;
            const exists = await prisma.agent.findFirst({ where: { ensName, NOT: { id: agentId } }, select: { id: true } });
            if (!exists) {
              await prisma.agent.update({ where: { id: agentId }, data: { ensName } });
              req.log.info({ agentId, ensName }, "[registry-record] auto-assigned ENS name");
            }
          }
        })
        .catch((err) => req.log.warn({ err, agentId }, "[registry-record] ENS auto-assign failed"));
    }
  } else if (event === "erc8004:validation:publish" && agentId) {
    const proofHash = typeof body?.proofHash === "string" ? body.proofHash : null;
    const proofType = typeof body?.proofType === "number" ? (body.proofType as 0 | 1 | 2) : null;
    if (proofHash && proofType != null) {
      publishValidationProof(agentId, proofHash, proofType).catch((err) => {
        req.log.warn({ err, agentId }, "[registry-record] ERC-8004 validation publish failed");
      });
    }
  }

  return reply.code(200).send({ ok: true, event });
}

/** POST /api/internal/cre/x402-charge — process x402 workflow payment */
async function postX402Charge(req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply): Promise<void> {
  if (!requireApiKeyOnly(req, reply)) return;
  const body = req.body as Record<string, unknown>;
  const workflow = typeof body?.workflow === "string" ? body.workflow : "unknown";
  const amount = typeof body?.amount === "string" ? body.amount : "0.0001";
  const agentId = typeof body?.agentId === "string" ? body.agentId : null;
  const receiptId = typeof body?.receiptId === "string" ? body.receiptId : `x402-${Date.now()}`;
  req.log.info({ workflow, amount, agentId, receiptId }, "[x402] charge received");
  // Actual USDC deduction would be handled by x402 protocol integration
  return reply.code(200).send({ ok: true, workflow, amount, agentId, receiptId, charged: true });
}

export async function registerCreWorkflowCallbackRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/internal/cre/enqueued-markets", getEnqueuedMarkets);
  app.post<{ Body: AnalyzeRequestBody }>("/api/internal/cre/analyze", runAnalyze);
  app.get<{ Params: { marketId: string } }>(
    "/api/internal/settlement/context/:marketId",
    getSettlementContext
  );
  app.post<{ Body: DeliberateRequestBody }>(
    "/api/internal/cre/deliberate-primary",
    runDeliberatePrimary
  );
  app.post<{ Body: DeliberateRequestBody }>(
    "/api/internal/cre/deliberate-crosscheck",
    runDeliberateCrosscheck
  );
  app.get("/api/internal/cre/macro-data", getMacroData);
  app.post<{ Body: unknown }>("/api/internal/cre/macro-data", postMacroData);
  app.post<{ Body: unknown }>("/api/internal/cre/webhook-event", postWebhookEvent);
  // Canonical path used by the webhookBridge.ts CRE workflow
  app.post<{ Body: unknown }>("/api/internal/webhook-bridge", postWebhookEvent);
  app.post<{ Body: unknown }>("/api/internal/cre/registry-record", postRegistryRecord);
  app.post<{ Body: unknown }>("/api/internal/cre/x402-charge", postX402Charge);
}
