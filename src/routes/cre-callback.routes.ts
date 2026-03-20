/**
 * CRE callback routes: CRE gateway (or workflow) POSTs results here so the backend can persist them.
 * - /api/internal/cre/*: require x-api-key.
 * - /api/cre/agent-keys: require Authorization: CRE-Generated <apiKey>.
 * - /api/internal/registry-sync: update Postgres cache from on-chain market data.
 * - /api/internal/analysis-complete: record CRE agent analysis completion.
 * - /api/internal/escalate: record settlement escalation when LLMs disagree.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getCreGeneratedApiKey, verifyCreGeneratedKey } from "../lib/auth.js";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { getPrismaClient } from "../lib/prisma.js";
import { getSocketManager } from "../services/websocket.service.js";
import { CRE_PENDING_PUBLIC_KEY } from "../schemas/agent.schema.js";
import { encryptPrivateKey } from "../services/agent-keys.service.js";
import { executeAgentOnboarding } from "../services/agent-onboarding.service.js";
import {
  creCreateWalletResultSchema,
  creAgentKeysSchema,
  creLmsrPricingResultSchema,
  creBuySellCallbackSchema,
  type CreCreateWalletResultInput,
  type CreAgentKeysInput,
  type CreLmsrPricingResultInput,
  type CreBuySellCallbackInput,
} from "../schemas/cre-callback.schema.js";
import { handleCreLmsrPricingCallback } from "../services/cre-lmsr-pricing.service.js";
import { persistCreBuySellCallback } from "../services/cre-buy-sell-callback.service.js";
import { WS_EVENT_NAMES } from "../types/websocket-events.js";
import { ROOM_PATTERNS } from "../config/index.js";

/** Strategy guard shape — schema has these fields; cast used until full prisma generate propagates */
interface StrategyGuard {
  riskLevel: string | null;
  maxExposureUsd: number | null;
  allowedMarketTypes: string | null;
  maxDailyTrades: number | null;
}

export async function registerCreCallbackRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/internal/cre/create-wallet-result – store agent wallet address and optional CRE-only encrypted key. */
  app.post<{ Body: unknown }>(
    "/api/internal/cre/create-wallet-result",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const parsed = creCreateWalletResultSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
      }
      const { agentId, address, encryptedPrivateKey } = parsed.data as CreCreateWalletResultInput;
      const prisma = getPrismaClient();
      const existing = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { id: true, walletAddress: true, publicKey: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      if (existing.walletAddress != null && String(existing.walletAddress).trim() !== "") {
        return reply.code(409).send({ error: "Agent already has a wallet" });
      }
      const updateData: { walletAddress: string; publicKey?: string; encryptedPrivateKey?: string } = {
        walletAddress: address,
      };
      if (existing.publicKey === CRE_PENDING_PUBLIC_KEY) {
        updateData.publicKey = address;
      }
      if (encryptedPrivateKey?.trim()) {
        updateData.encryptedPrivateKey = encryptedPrivateKey.trim();
      }
      const agent = await prisma.agent.update({
        where: { id: agentId },
        data: updateData,
        select: { id: true, walletAddress: true },
      });
      return reply.code(200).send({
        agentId: agent.id,
        walletAddress: agent.walletAddress,
        stored: true,
      });
    }
  );

  /** POST /api/cre/agent-keys – CRE agent creation callback. Detour: encryptedKeyBlob = private key; we encrypt and store it, run onboarding (fund ETH + agent signs USDC/CT approvals). CRE signed txs are ignored. */
  app.post<{ Body: unknown }>(
    "/api/cre/agent-keys",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      const token = getCreGeneratedApiKey(req);
      if (!token || !verifyCreGeneratedKey(token)) {
        return reply.code(401).send({ error: "Authorization required", detail: "Use Authorization: CRE-Generated <apiKey>" });
      }

      const parsed = creAgentKeysSchema.safeParse(req.body);
      if (!parsed.success) {
        req.log.warn({ validationError: parsed.error.flatten() }, "CRE agent-keys: validation failed");
        return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
      }
      const data = parsed.data as CreAgentKeysInput;
      const { agentId, address, encryptedKeyBlob } = data;
      req.log.info(
        { agentId: agentId ?? null, address, hasEncryptedKeyBlob: Boolean(encryptedKeyBlob?.trim()) },
        "CRE agent-keys: parsed body (detour: onboarding with agent key)"
      );

      if (!encryptedKeyBlob?.trim()) {
        return reply.code(400).send({ error: "encryptedKeyBlob (private key) required" });
      }

      const rawPrivateKey = encryptedKeyBlob.trim();
      const normalizedPk = rawPrivateKey.startsWith("0x")
        ? rawPrivateKey
        : `0x${rawPrivateKey}`;

      if (!agentId) {
        const onboardingResult = await executeAgentOnboarding(normalizedPk, address, req.log);
        return reply.code(200).send({
          stored: false,
          message: "agentId required for agent storage; onboarding executed",
          onboarding: onboardingResult,
        });
      }

      const prisma = getPrismaClient();
      const existing = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { id: true, walletAddress: true, publicKey: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      if (existing.walletAddress != null && String(existing.walletAddress).trim() !== "") {
        return reply.code(409).send({ error: "Agent already has a wallet" });
      }

      reply.code(202).send({
        accepted: true,
        agentId,
        message: "Onboarding in progress; agent will be updated when transactions confirm",
      });

      void (async () => {
        const onboardingResult = await executeAgentOnboarding(normalizedPk, address, req.log);
        req.log.info({ onboardingResult }, "CRE agent-keys: onboarding result");

        const encryptedStored = encryptPrivateKey(normalizedPk);
        await prisma.agent.update({
          where: { id: agentId },
          data: {
            walletAddress: address,
            publicKey: address,
            encryptedPrivateKey: encryptedStored,
          },
          select: { id: true, walletAddress: true },
        });
        req.log.info({ agentId, walletAddress: address }, "CRE agent-keys: agent stored (background)");
      })();
    }
  );

  /** POST /api/cre/lmsr-pricing – CRE sends LMSR pricing result after computing quote */
  app.post<{ Body: unknown }>(
    "/api/cre/lmsr-pricing",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      // Parse and validate the incoming pricing result
      const parsed = creLmsrPricingResultSchema.safeParse(req.body);
      if (!parsed.success) {
        req.log.warn({ validationError: parsed.error.flatten() }, "CRE lmsr-pricing: validation failed");
        return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
      }

      const data = parsed.data as CreLmsrPricingResultInput;
      req.log.info(
        { marketId: data.marketId, requestId: data.requestId, tradeCostUsdc: data.tradeCostUsdc },
        "CRE lmsr-pricing: received pricing result"
      );

      // Handle the pricing callback - broadcasts via WebSocket
      await handleCreLmsrPricingCallback({
        marketId: data.marketId,
        deadline: data.deadline,
        donSignature: data.donSignature,
        nonce: data.nonce,
        tradeCostUsdc: data.tradeCostUsdc,
        requestId: data.requestId,
        outcomeIndex: data.outcomeIndex,
        quantity: data.quantity,
        metadata: data.metadata,
      });

      return reply.code(200).send({
        success: true,
        requestId: data.requestId,
        message: "Pricing result processed and broadcast",
      });
    }
  );

  const handleCreBuySellCallback = async (
    req: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
    side: "BID" | "ASK"
  ) => {
    const parsed = creBuySellCallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log.warn({ validationError: parsed.error.flatten() }, `CRE ${side === "BID" ? "buy" : "sell"}: validation failed`);
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const body = parsed.data as CreBuySellCallbackInput;
    req.log.info(
      { questionId: body.questionId, outcomeIndex: body.outcomeIndex, buy: body.buy, txHash: body.txHash, txHashes: body.txHashes },
      `CRE ${side === "BID" ? "buy" : "sell"}: received callback`
    );
    const prisma = getPrismaClient();
    const result = await persistCreBuySellCallback(prisma, body, side);
    if (result.error && result.updated === 0) {
      return reply.code(404).send({ error: result.error, updated: 0, orderIds: [] });
    }
    return reply.code(200).send({
      success: true,
      updated: result.updated,
      orderIds: result.orderIds,
    });
  };

  /** POST /api/cre/buy – CRE sends trade result (tx hash + quote fields) after executing a buy. Stored in order.crePayload. */
  app.post<{ Body: unknown }>("/api/cre/buy", async (req, reply) => handleCreBuySellCallback(req, reply, "BID"));

  /** POST /api/cre/sell – CRE sends trade result (tx hash + quote fields) after executing a sell. Stored in order.crePayload. */
  app.post<{ Body: unknown }>("/api/cre/sell", async (req, reply) => handleCreBuySellCallback(req, reply, "ASK"));

  /**
   * POST /api/internal/registry-sync
   * Called by market-discovery and registry-sync CRE workflows to keep Postgres cache aligned with on-chain state.
   * Body: { markets: Array<{ marketId, questionId?, txHash?, workflowRunId? }>, source?: string }
   */
  app.post<{ Body: unknown }>(
    "/api/internal/registry-sync",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;

      const body = req.body as Record<string, unknown>;
      const markets = Array.isArray(body?.markets) ? (body.markets as Record<string, unknown>[]) : [];
      const source = typeof body?.source === "string" ? body.source : "cre-workflow";

      if (markets.length === 0) {
        return reply.code(200).send({ synced: 0, source });
      }

      const prisma = getPrismaClient();
      let synced = 0;

      for (const m of markets) {
        const marketId = typeof m.marketId === "string" ? m.marketId : null;
        if (!marketId) continue;
        try {
          await prisma.market.updateMany({
            where: { id: marketId },
            data: {
              ...(typeof m.txHash === "string" ? { onchainTxHash: m.txHash } : {}),
              ...(typeof m.workflowRunId === "string" ? { workflowRunId: m.workflowRunId } : {}),
            },
          });
          synced++;
        } catch (err) {
          req.log.warn({ err, marketId }, "registry-sync: market update failed");
        }
      }

      try {
        const manager = getSocketManager();
        await manager.broadcastToRoom("markets", {
          type: WS_EVENT_NAMES.REGISTRY_SYNC_UPDATE,
          payload: { synced, source, markets: markets.map((m) => m.marketId) as string[], syncedAt: new Date().toISOString() },
        });
      } catch (err) {
        req.log.warn({ err }, "registry-sync: WebSocket broadcast failed");
      }

      return reply.code(200).send({ synced, source });
    }
  );

  /**
   * POST /api/internal/analysis-complete
   * Called by agent-analysis CRE workflow after completing analysis for an agent+market pair.
   * Body: { agentId, marketId, action, orderSubmitted?, source? }
   */
  app.post<{ Body: unknown }>(
    "/api/internal/analysis-complete",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;

      const body = req.body as Record<string, unknown>;
      const agentId = typeof body?.agentId === "string" ? body.agentId : null;
      const marketId = typeof body?.marketId === "string" ? body.marketId : null;

      if (!agentId || !marketId) {
        return reply.code(400).send({ error: "agentId and marketId required" });
      }

      const action = typeof body?.action === "string" ? body.action : "skip";
      const orderSubmitted = Boolean(body?.orderSubmitted);
      const workflowRunId = typeof body?.workflowRunId === "string" ? body.workflowRunId : undefined;

      const prisma = getPrismaClient();
      try {
        await prisma.agentEnqueuedMarket.updateMany({
          where: { agentId, marketId },
          data: {
            ...(workflowRunId ? { workflowRunId } : {}),
          },
        });
      } catch (err) {
        req.log.warn({ err, agentId, marketId }, "analysis-complete: DB update failed");
      }

      try {
        const manager = getSocketManager();
        await manager.broadcastToRoom(`agent:${agentId}`, {
          type: WS_EVENT_NAMES.ANALYSIS_COMPLETE,
          payload: { agentId, marketId, action, orderSubmitted, workflowRunId },
        });
      } catch (err) {
        req.log.warn({ err }, "analysis-complete: WebSocket broadcast failed");
      }

      return reply.code(200).send({ ok: true, agentId, marketId, action, orderSubmitted });
    }
  );

  /**
   * POST /api/internal/escalate
   * Called by settlement-consensus CRE workflow when both LLM agents disagree on outcome.
   * Body: { marketId, questionId, agent1Opinion?, agent2Opinion?, reason?, workflowRunId? }
   */
  app.post<{ Body: unknown }>(
    "/api/internal/escalate",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;

      const body = req.body as Record<string, unknown>;
      const marketId = typeof body?.marketId === "string" ? body.marketId : null;
      const questionId = typeof body?.questionId === "string" ? body.questionId : null;

      if (!marketId) return reply.code(400).send({ error: "marketId required" });
      const reason = typeof body?.reason === "string" ? body.reason : "agents_disagree";
      const workflowRunId = typeof body?.workflowRunId === "string" ? body.workflowRunId : undefined;
      const prisma = getPrismaClient();
      if (workflowRunId) {
        // workflowRunId added to Market in schema; cast until prisma generate propagates in TS server
        await prisma.market.update({ where: { id: marketId }, data: { workflowRunId } as never }).catch((err: unknown) => {
          req.log.warn({ err, marketId }, "escalate: DB update failed");
        });
      }
      req.log.warn({ marketId, questionId, reason }, "Settlement escalated: LLM agents did not reach consensus.");
      getSocketManager().broadcastToRoom("markets", {
        type: WS_EVENT_NAMES.SETTLEMENT_ESCALATED,
        payload: { marketId, questionId, reason, workflowRunId },
      }).catch((err: unknown) => req.log.warn({ err }, "escalate: WS broadcast failed"));
      return reply.code(200).send({ escalated: true, marketId, questionId, reason });
    }
  );

  /** POST /api/internal/compliance/check — agent guard before every CRE trade or analysis. */
  app.post<{ Body: unknown }>(
    "/api/internal/compliance/check",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const body = req.body as Record<string, unknown>;
      const walletAddress = typeof body?.walletAddress === "string" ? body.walletAddress.trim() : null;
      if (!walletAddress) return reply.code(400).send({ error: "walletAddress required" });

      const prisma = getPrismaClient();
      const agent = await prisma.agent
        .findFirst({ where: { walletAddress }, select: { id: true, status: true } })
        .catch(() => null);

      if (!agent) return reply.code(200).send({ allowed: true, reason: "no_agent_config" });
      if (agent.status !== "ACTIVE")
        return reply.code(200).send({ allowed: false, reason: `agent_${agent.status?.toLowerCase() ?? "inactive"}` });

      const strategy = (await prisma.agentStrategy
        .findUnique({ where: { agentId: agent.id } })
        .catch(() => null)) as unknown as StrategyGuard | null;
      if (!strategy) return reply.code(200).send({ allowed: true, reason: "no_strategy" });

      if (strategy.maxDailyTrades != null || strategy.maxExposureUsd != null) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const track = await prisma.agentTrack
          .findFirst({ where: { agentId: agent.id, date: today }, select: { trades: true, exposure: true } })
          .catch(() => null);
        if (strategy.maxDailyTrades != null && (track?.trades ?? 0) >= strategy.maxDailyTrades)
          return reply.code(200).send({ allowed: false, reason: "daily_trade_limit_reached" });
        if (strategy.maxExposureUsd != null && track?.exposure != null && parseFloat(String(track.exposure)) >= strategy.maxExposureUsd)
          return reply.code(200).send({ allowed: false, reason: "max_exposure_reached" });
      }

      const marketId = typeof body?.marketId === "string" ? body.marketId : null;
      if (strategy.allowedMarketTypes && marketId) {
        const market = await prisma.market
          .findUnique({ where: { id: marketId }, select: { platform: true } })
          .catch(() => null);
        if (market) {
          try {
            const allowed = JSON.parse(strategy.allowedMarketTypes) as string[];
            if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(market.platform))
              return reply.code(200).send({ allowed: false, reason: "market_type_not_allowed" });
          } catch { /* malformed allowedMarketTypes — skip */ }
        }
      }
      return reply.code(200).send({ allowed: true, reason: "ok" });
    }
  );

  /** Shared handler for CRE trade event callbacks — broadcasts to market room + returns ok. */
  const handleCreTradeEvent = async (
    req: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
    creEvent: string
  ): Promise<void> => {
    if (!requireApiKeyOnly(req, reply)) return;
    const body = req.body as Record<string, unknown>;
    const marketId = typeof body?.marketId === "string" ? body.marketId.trim() : null;
    if (!marketId) { reply.code(400).send({ error: "marketId required" }); return; }
    const ws = getSocketManager();
    ws?.broadcastToRoom(ROOM_PATTERNS.MARKET(marketId), {
      type: WS_EVENT_NAMES.MARKET_UPDATED,
      payload: { marketId, reason: "updated", status: creEvent },
    });
    reply.code(200).send({ ok: true, creEvent, marketId });
  };

  app.post<{ Body: unknown }>("/api/cre/quote", (req, reply) => handleCreTradeEvent(req, reply, "quote"));
  app.post<{ Body: unknown }>("/api/cre/stake", (req, reply) => handleCreTradeEvent(req, reply, "stake"));
  app.post<{ Body: unknown }>("/api/cre/redeem", (req, reply) => handleCreTradeEvent(req, reply, "redeem"));
  app.post<{ Body: unknown }>("/api/cre/execute-confidential-trade", (req, reply) => handleCreTradeEvent(req, reply, "confidential_trade"));
}
