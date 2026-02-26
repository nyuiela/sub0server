import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getPrismaClient } from "../lib/prisma.js";
import { requireUserOrApiKey } from "../lib/permissions.js";
import { requireUser, requireApiKey } from "../lib/auth.js";

const querySchema = z.object({
  agentId: z.string().uuid().optional(),
  status: z.enum(["PENDING", "FULFILLED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

type QueryInput = z.infer<typeof querySchema>;

function serializePendingTrade(row: {
  id: string;
  agentId: string;
  marketId: string;
  outcomeIndex: number;
  side: string;
  quantity: { toString(): string };
  status: string;
  pendingReason: string;
  orderId: string | null;
  createdAt: Date;
  fulfilledAt: Date | null;
  agent?: { id: string; name: string };
  market?: { id: string; name: string; outcomes: unknown };
}) {
  return {
    id: row.id,
    agentId: row.agentId,
    marketId: row.marketId,
    outcomeIndex: row.outcomeIndex,
    side: row.side,
    quantity: row.quantity.toString(),
    status: row.status,
    pendingReason: row.pendingReason,
    orderId: row.orderId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    fulfilledAt: row.fulfilledAt?.toISOString() ?? undefined,
    agent: row.agent,
    market: row.market,
  };
}

export async function registerAgentPendingTradesRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/agent-pending-trades",
    async (req: FastifyRequest<{ Querystring: unknown }>, reply: FastifyReply) => {
      if (!requireUserOrApiKey(req, reply)) return;
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
      }
      const { agentId, status, limit, offset } = parsed.data as QueryInput;
      const prisma = getPrismaClient();
      const isApiKey = requireApiKey(req);
      const authUser = requireUser(req);

      let agentIdsFilter: string[] | undefined;
      if (!isApiKey && authUser?.userId) {
        const owned = await prisma.agent.findMany({
          where: { ownerId: authUser.userId },
          select: { id: true },
        });
        agentIdsFilter = owned.map((a) => a.id);
        if (agentIdsFilter.length === 0) {
          return reply.send({ data: [], total: 0, limit, offset });
        }
      }

      const where = {
        ...(agentId ? { agentId } : {}),
        ...(agentIdsFilter ? { agentId: { in: agentIdsFilter } } : {}),
        ...(status ? { status } : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.pendingAgentTrade.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { createdAt: "desc" },
          include: {
            agent: { select: { id: true, name: true } },
            market: { select: { id: true, name: true, outcomes: true } },
          },
        }),
        prisma.pendingAgentTrade.count({ where }),
      ]);

      return reply.send({
        data: rows.map(serializePendingTrade),
        total,
        limit,
        offset,
      });
    }
  );
}
