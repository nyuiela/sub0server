import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { Decimal } from "decimal.js";
import { getPrismaClient } from "../lib/prisma.js";
import { submitOrder } from "../engine/order-queue.js";
import { requireUserOrApiKey } from "../lib/permissions.js";
import { requireUser, requireApiKey } from "../lib/auth.js";
import { orderSubmitSchema, type OrderSubmitInput } from "../schemas/order.schema.js";
import type { CreOrderPayload } from "../types/cre-order.js";
import { executeUserMarketTradeOnCre } from "../services/cre-execute-trade.service.js";
import { enqueueOrderAndTradesForPersistence } from "../workers/trades-queue.js";
import { getRedisPublisher } from "../lib/redis.js";
import { REDIS_CHANNELS } from "../config/index.js";
import type { EngineOrder, ExecutedTrade } from "../types/order-book.js";

export async function registerOrderRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/orders", async (req: FastifyRequest<{ Body: unknown }>, reply: FastifyReply) => {
    if (!requireUserOrApiKey(req, reply)) return;
    console.log("req.body", req.body);
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
      select: { outcomes: true, questionId: true, conditionId: true },
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

    const isUserOrder = userId != null && userId !== "" && (agentId == null || agentId === "");
    if (isUserOrder && (!market.questionId || !market.conditionId)) {
      return reply.code(400).send({
        error: "Market has no questionId/conditionId; CRE execution requires them for user orders",
      });
    }

    let crePayload: CreOrderPayload | undefined;
    if (isUserOrder && raw.userSignature && raw.tradeCostUsdc != null && raw.nonce != null && raw.deadline != null && market.questionId && market.conditionId) {
      crePayload = {
        questionId: market.questionId,
        conditionId: market.conditionId,
        outcomeIndex: raw.outcomeIndex,
        buy: raw.side === "BID",
        quantity: raw.quantity as any,
        tradeCostUsdc: raw.tradeCostUsdc,
        nonce: raw.nonce,
        deadline: raw.deadline,
        userSignature: raw.userSignature,
      };
    }

    const orderId = randomUUID();
    const input = {
      id: orderId,
      marketId: raw.marketId,
      outcomeIndex: raw.outcomeIndex,
      side: raw.side,
      type,
      price: String(price),
      quantity: raw.quantity,
      userId,
      agentId,
      crePayload: crePayload ?? null,
    };

    if (type === "MARKET" && isUserOrder && crePayload) {
      try {
        const creResult = await executeUserMarketTradeOnCre(crePayload, raw.side);
        if (!creResult.ok) {
          return reply.code(502).send({
            error: "CRE execution failed",
            message: creResult.error ?? "Unknown error",
          });
        }
        const qtyStr = String(raw.quantity);
        // const priceStr = new Decimal(crePayload.tradeCostUsdc).div(1e6).div(qtyStr).toFixed(18);
        const executedAt = Date.now();
        const tradeId = `trade-market-cre-${raw.marketId}-${raw.outcomeIndex}-${executedAt}-${randomUUID().slice(0, 8)}`;
        const order: EngineOrder = {
          id: orderId,
          marketId: raw.marketId,
          outcomeIndex: raw.outcomeIndex,
          side: raw.side,
          type: "MARKET",
          price: "0",
          quantity: crePayload.quantity,
          remainingQty: "0",
          status: "FILLED",
          createdAt: executedAt,
          userId: userId ?? undefined,
          agentId: agentId ?? undefined,
          crePayload: null,
        };
        const trade: ExecutedTrade = {
          id: tradeId,
          marketId: raw.marketId,
          outcomeIndex: raw.outcomeIndex,
          price: crePayload.tradeCostUsdc,
          quantity: crePayload.quantity,
          makerOrderId: "contract",
          takerOrderId: orderId,
          side: raw.side,
          userId: userId ?? undefined,
          agentId: agentId ?? undefined,
          makerUserId: null,
          makerAgentId: null,
          executedAt,
        };
        await enqueueOrderAndTradesForPersistence(order, [trade]);
        const redis = await getRedisPublisher();
        await redis.publish(REDIS_CHANNELS.TRADES, JSON.stringify({ trade }));
        await redis.publish(REDIS_CHANNELS.MARKET_UPDATES, JSON.stringify({ marketId: raw.marketId, reason: "orderbook" }));
        return reply.code(201).send({
          orderId,
          type: "MARKET",
          status: "FILLED",
          trades: [{ ...trade }],
          txHash: creResult.txHash,
        });
      } catch (err) {
        req.log.error(err);
        return reply.code(500).send({
          error: "MARKET order failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    try {
      const result = await submitOrder(input);
      return reply.code(201).send({
        orderId: input.id,
        type: input.type,
        status: result.order.status,
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
