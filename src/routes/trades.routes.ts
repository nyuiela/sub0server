import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { getPrismaClient } from "../lib/prisma.js";

const tradesQuerySchema = z.object({
  marketId: z.string().optional(),
  userId: z.string().optional(),
  agentId: z.string().optional(),
  chainKey: z.enum(["main", "tenderly"]).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

type TradesQueryInput = z.infer<typeof tradesQuerySchema>;

export async function registerTradesRoutes(app: FastifyInstance): Promise<void> {
  // Get trades with filtering
  app.get("/api/trades", async (req: FastifyRequest<{ Querystring: TradesQueryInput }>, reply: FastifyReply) => {
    const parsed = tradesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const { marketId, userId, agentId, chainKey, limit, offset } = parsed.data;
    const prisma = getPrismaClient();

    try {
      const where = {
        ...(marketId && { marketId }),
        ...(userId && { userId }),
        ...(agentId && { agentId }),
        ...(chainKey === "tenderly" && { chainKey: "tenderly" }),
        ...(chainKey === "main" && {
          OR: [{ chainKey: "main" }, { chainKey: null }],
        }),
      };

      const [trades, total] = await Promise.all([
        prisma.trade.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { createdAt: "desc" },
          include: {
            market: {
              select: {
                id: true,
                name: true,
                outcomes: true,
              },
            },
            user: {
              select: {
                id: true,
                username: true,
                address: true,
              },
            },
            agent: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
        prisma.trade.count({ where }),
      ]);

      // Serialize trades
      const serializedTrades = trades.map((trade) => ({
        ...trade,
        amount: trade.amount.toString(),
        price: trade.price.toString(),
        market: {
          ...trade.market,
          outcomes: trade.market.outcomes as unknown[],
        },
      }));

      return reply.send({
        data: serializedTrades,
        total,
        limit,
        offset,
      });
    } catch (error) {
      console.error("Failed to get trades:", error);
      return reply.code(500).send({ error: "Failed to get trades" });
    }
  });

  // Get single trade by ID
  app.get("/api/trades/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    const prisma = getPrismaClient();

    try {
      const trade = await prisma.trade.findUnique({
        where: { id },
        include: {
          market: {
            select: {
              id: true,
              name: true,
              outcomes: true,
            },
          },
          user: {
            select: {
              id: true,
              username: true,
              address: true,
            },
          },
          agent: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!trade) {
        return reply.code(404).send({ error: "Trade not found" });
      }

      const serializedTrade = {
        ...trade,
        amount: trade.amount.toString(),
        price: trade.price.toString(),
        market: {
          ...trade.market,
          outcomes: trade.market.outcomes as unknown[],
        },
      };

      return reply.send(serializedTrade);
    } catch (error) {
      console.error("Failed to get trade:", error);
      return reply.code(500).send({ error: "Failed to get trade" });
    }
  });
}
