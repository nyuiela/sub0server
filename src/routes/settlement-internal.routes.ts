/**
 * Internal settlement routes: list markets due for resolution, run deliberation, return payouts for CRE.
 * Require API key (same as agent-markets-internal). questionId = onchain Sub0 questionId (bytes32 hex).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireApiKeyOnly } from "../lib/permissions.js";
import { getPrismaClient } from "../lib/prisma.js";
import {
  findMarketsDueForSettlement,
  deliberateAndPersist,
  outcomeArrayToPayouts,
} from "../services/settlement.service.js";

function parseOutcomes(outcomes: unknown): string[] {
  if (Array.isArray(outcomes)) {
    return outcomes.filter((o): o is string => typeof o === "string");
  }
  return [];
}

export async function registerSettlementInternalRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get(
    "/api/internal/settlement/due",
    async (
      req: FastifyRequest<{ Querystring: { limit?: string } }>,
      reply: FastifyReply
    ) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const markets = await findMarketsDueForSettlement(limit);
      return reply.send({
        data: markets.map((m) => ({
          id: m.id,
          name: m.name,
          conditionId: m.conditionId,
          resolutionDate: m.resolutionDate.toISOString(),
          status: m.status,
          outcomes: m.outcomes,
          settlementRules: m.settlementRules,
        })),
        count: markets.length,
      });
    }
  );

  app.post(
    "/api/internal/settlement/run",
    async (req: FastifyRequest<{ Body: { marketId?: string; questionId?: string } }>, reply: FastifyReply) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const body = req.body ?? {};
      const marketId = body.marketId;
      const questionId = body.questionId;
      if (typeof marketId !== "string" || !marketId || typeof questionId !== "string" || !questionId) {
        return reply.code(400).send({
          error: "marketId and questionId (onchain bytes32 hex) are required",
        });
      }

      const prisma = getPrismaClient();
      const market = await prisma.market.findUnique({
        where: { id: marketId },
        select: {
          id: true,
          name: true,
          outcomes: true,
          settlementRules: true,
          status: true,
        },
      });
      if (!market) {
        return reply.code(404).send({ error: "Market not found" });
      }
      if (market.status !== "OPEN") {
        return reply.code(409).send({ error: "Market is not OPEN", status: market.status });
      }

      const outcomes = parseOutcomes(market.outcomes);
      if (outcomes.length === 0) {
        return reply.code(400).send({ error: "Market has no outcomes" });
      }

      try {
        const result = await deliberateAndPersist(
          market.id,
          questionId,
          market.name,
          outcomes,
          market.settlementRules ?? null
        );

        const payouts =
          result.outcomeArray != null
            ? outcomeArrayToPayouts(result.outcomeArray).map((n) => n.toString())
            : null;

        return reply.send({
          canResolve: result.canResolve,
          questionId,
          outcomeArray: result.outcomeArray,
          payouts,
          outcomeString: result.outcomeString,
          consensus: result.deliberation.consensus,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.warn({ err, marketId }, "Settlement deliberation failed");
        return reply.code(500).send({
          error: "Settlement deliberation failed",
          details: msg,
        });
      }
    }
  );

  /** POST /api/internal/settlement/resolved – CRE callback after successful writeReport; sets market status to RESOLVED. */
  app.post(
    "/api/internal/settlement/resolved",
    async (
      req: FastifyRequest<{
        Body: { marketId?: string; questionId?: string; txHash?: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!requireApiKeyOnly(req, reply)) return;
      const body = req.body ?? {};
      const marketId = typeof body.marketId === "string" ? body.marketId.trim() : "";
      if (!marketId) {
        return reply.code(400).send({ error: "marketId is required" });
      }
      const prisma = getPrismaClient();
      const market = await prisma.market.findUnique({
        where: { id: marketId },
        select: { id: true, status: true },
      });
      if (!market) {
        return reply.code(404).send({ error: "Market not found" });
      }
      if (market.status !== "OPEN") {
        return reply.code(200).send({
          status: "ok",
          marketId,
          previousStatus: market.status,
          message: "Market already not OPEN",
        });
      }
      await prisma.market.update({
        where: { id: marketId },
        data: { status: "CLOSED" },
      });
      return reply.send({
        status: "ok",
        marketId,
        previousStatus: "OPEN",
        newStatus: "CLOSED",
        txHash: typeof body.txHash === "string" ? body.txHash : undefined,
      });
    }
  );
}
