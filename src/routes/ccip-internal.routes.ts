/**
 * CCIP internal routes — called by CRE crossChainSync workflow.
 * GET  /api/internal/cre/active-markets — fetch active markets for CCIP broadcast
 * POST /api/internal/cre/ccip-send      — record a successful CCIP send event
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { getPrismaClient } from "../lib/prisma.js";
import { getSocketManager } from "../services/websocket.service.js";
import { WS_EVENT_NAMES } from "../types/websocket-events.js";
import { ROOM_PATTERNS } from "../config/index.js";

interface CcipSendBody {
  marketId?: string;
  destinationChain?: string;
  messageId?: string;
  txHash?: string;
  status?: "sent" | "failed";
}

export async function registerCcipInternalRoutes(
  app: FastifyInstance
): Promise<void> {
  /**
   * GET /api/internal/cre/active-markets
   * Returns OPEN markets with questionId set — used by crossChainSync to know what to broadcast.
   */
  app.get(
    "/api/internal/cre/active-markets",
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const limitParam = (req.query as Record<string, string>)?.limit;
      const limit = Math.max(1, Math.min(100, Number(limitParam ?? "50")));

      const prisma = getPrismaClient();
      const markets = await prisma.market
        .findMany({
          where: { status: "OPEN", questionId: { not: null } },
          take: limit,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            questionId: true,
            conditionId: true,
            onchainTxHash: true,
            status: true,
            resolutionDate: true,
            outcomes: true,
          },
        })
        .catch(() => []);

      return reply.code(200).send({ markets });
    }
  );

  /**
   * POST /api/internal/cre/ccip-send
   * Records a CCIP send event (message dispatched to another chain) and broadcasts via WS.
   */
  app.post<{ Body: unknown }>(
    "/api/internal/cre/ccip-send",
    async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const body = req.body as Partial<CcipSendBody>;
      const marketId = typeof body?.marketId === "string" ? body.marketId.trim() : null;

      if (!marketId) {
        return reply.code(400).send({ error: "marketId required" });
      }

      const prisma = getPrismaClient();
      const market = await prisma.market
        .findUnique({ where: { id: marketId }, select: { id: true, name: true } })
        .catch(() => null);

      if (!market) {
        return reply.code(404).send({ error: "Market not found" });
      }

      const ws = getSocketManager();
      if (ws) {
        ws.broadcastToRoom(ROOM_PATTERNS.MARKET(marketId), {
          type: WS_EVENT_NAMES.MARKET_UPDATED,
          payload: {
            marketId,
            reason: "updated",
          },
        });
      }

      return reply.code(200).send({ ok: true, marketId, messageId: body.messageId ?? null });
    }
  );
}
