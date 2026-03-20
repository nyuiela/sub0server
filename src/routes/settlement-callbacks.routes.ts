/**
 * Settlement callback routes — called by CRE settlementConsensus workflow.
 * GET  /api/internal/settlement/due        — fetch markets ready for resolution
 * POST /api/internal/settlement/run        — run deliberation for a given market
 * POST /api/internal/settlement/resolved   — mark market RESOLVED + WS broadcast
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { getPrismaClient } from "../lib/prisma.js";
import { getSocketManager } from "../services/websocket.service.js";
import {
  findMarketsDueForSettlement,
  deliberateAndPersist,
} from "../services/settlement.service.js";
import { WS_EVENT_NAMES } from "../types/websocket-events.js";
import { ROOM_PATTERNS } from "../config/index.js";

interface SettlementRunBody {
  marketId: string;
  questionId: string;
  question: string;
  outcomes: string[];
  settlementRules?: string | null;
}

interface SettlementResolvedBody {
  marketId: string;
  questionId: string;
  outcomeIndex?: number;
  onchainTxHash?: string;
  workflowRunId?: string;
}

export async function registerSettlementCallbackRoutes(
  app: FastifyInstance
): Promise<void> {
  /** GET /api/internal/settlement/due — returns markets whose resolutionDate has passed and status is OPEN. */
  app.get(
    "/api/internal/settlement/due",
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const limitParam = (req.query as Record<string, string>)?.limit;
      const limit = Math.max(1, Math.min(50, Number(limitParam ?? "10")));
      const markets = await findMarketsDueForSettlement(limit).catch(() => []);
      return reply.code(200).send({ markets });
    }
  );

  /** POST /api/internal/settlement/run — run two-agent LLM deliberation and persist log. */
  app.post<{ Body: unknown }>(
    "/api/internal/settlement/run",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const body = req.body as Record<string, unknown>;
      const marketId = typeof body?.marketId === "string" ? body.marketId.trim() : null;
      const questionId = typeof body?.questionId === "string" ? body.questionId.trim() : null;
      const question = typeof body?.question === "string" ? body.question.trim() : null;
      const outcomes = Array.isArray(body?.outcomes)
        ? (body.outcomes as unknown[]).filter((o): o is string => typeof o === "string")
        : [];

      if (!marketId || !questionId || !question || outcomes.length < 2) {
        return reply.code(400).send({
          error: "marketId, questionId, question, and at least 2 outcomes required",
        });
      }

      const settlementRules =
        typeof body?.settlementRules === "string" ? body.settlementRules : null;

      const result = await deliberateAndPersist(
        marketId,
        questionId,
        question,
        outcomes,
        settlementRules
      ).catch((err: unknown) => {
        req.log.error({ err, marketId }, "[settlement-run] deliberation failed");
        return null;
      });

      if (!result) {
        return reply.code(500).send({ error: "Deliberation failed" });
      }

      return reply.code(200).send(result);
    }
  );

  /** POST /api/internal/settlement/resolved — persist RESOLVED status and broadcast via WS. */
  app.post<{ Body: unknown }>(
    "/api/internal/settlement/resolved",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const body = req.body as Partial<SettlementResolvedBody>;
      const marketId = typeof body?.marketId === "string" ? body.marketId.trim() : null;
      const questionId = typeof body?.questionId === "string" ? body.questionId.trim() : null;

      if (!marketId) {
        return reply.code(400).send({ error: "marketId required" });
      }

      const prisma = getPrismaClient();
      const updated = await prisma.market
        .update({
          where: { id: marketId },
          data: {
            status: "CLOSED",
            ...(body.onchainTxHash ? { onchainTxHash: body.onchainTxHash } : {}),
            ...(body.workflowRunId ? { workflowRunId: body.workflowRunId } : {}),
          },
          select: { id: true, status: true, name: true },
        })
        .catch((err: unknown) => {
          req.log.error({ err, marketId }, "[settlement-resolved] DB update failed");
          return null;
        });

      if (!updated) {
        return reply.code(500).send({ error: "DB update failed" });
      }

      const ws = getSocketManager();
      if (ws) {
        const payload = {
          type: WS_EVENT_NAMES.MARKET_UPDATED,
          payload: {
            marketId,
            reason: "resolved" as const,
            status: "CLOSED",
          },
        };
        ws.broadcastToRoom(ROOM_PATTERNS.MARKET(marketId), payload);
        ws.broadcastToRoom(ROOM_PATTERNS.MARKETS, payload);
      }

      return reply.code(200).send({ ok: true, marketId, status: "RESOLVED" });
    }
  );
}
