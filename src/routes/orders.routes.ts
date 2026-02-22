import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { getPrismaClient } from "../lib/prisma.js";
import { submitOrder } from "../engine/order-queue.js";
import { requireUserOrApiKey } from "../lib/permissions.js";
import { requireUser, requireApiKey } from "../lib/auth.js";
import { orderSubmitSchema, type OrderSubmitInput } from "../schemas/order.schema.js";

export async function registerOrderRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/orders", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    const parsed = orderSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
    }
    const raw: OrderSubmitInput = parsed.data;
    const type = raw.type;
    if (type === "LIMIT" && (raw.price === undefined || raw.price === null || raw.price === "")) {
      return reply.code(400).send({ error: "price is required for LIMIT orders" });
    }
    const price = type === "LIMIT" ? raw.price : "0";

    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({
      where: { id: raw.marketId },
      select: { outcomes: true },
    });
    if (!market) return reply.code(404).send({ error: "Market not found" });
    const outcomes = market.outcomes as unknown[];
    const outcomeCount = Array.isArray(outcomes) ? outcomes.length : 0;
    if (raw.outcomeIndex >= outcomeCount) {
      return reply.code(400).send({
        error: "outcomeIndex out of range",
        message: `Market has ${outcomeCount} outcome(s); outcomeIndex must be 0..${Math.max(0, outcomeCount - 1)}`,
      });
    }

    const isApiKey = requireApiKey(req);
    const authUser = requireUser(req);
    if (!isApiKey && authUser != null && authUser.userId == null) {
      return reply.code(403).send({ error: "User not registered; complete registration to place orders" });
    }
    const userId = isApiKey ? (raw.userId ?? undefined) : (authUser?.userId ?? undefined);
    const agentId = isApiKey ? (raw.agentId ?? undefined) : undefined;

    const input = {
      id: randomUUID(),
      marketId: raw.marketId,
      outcomeIndex: raw.outcomeIndex,
      side: raw.side,
      type,
      price: String(price),
      quantity: raw.quantity,
      userId,
      agentId,
    };
    try {
      const result = await submitOrder(input);
      return reply.code(201).send({
        orderId: input.id,
        trades: result.trades,
        snapshot: result.snapshot,
      });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({
        error: "Order failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
