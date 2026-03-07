import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { Decimal } from "decimal.js";
import { getPrismaClient } from "../lib/prisma.js";
import { submitOrder } from "../engine/order-queue.js";
import { requireUserOrApiKey } from "../lib/permissions.js";
import { requireUser, requireApiKey } from "../lib/auth.js";
import { orderSubmitSchema, type OrderSubmitInput } from "../schemas/order.schema.js";
import type { CreOrderPayload, AgentCrePayload } from "../types/cre-order.js";
import { executeUserMarketTradeOnCre } from "../services/cre-execute-trade.service.js";
import { enqueueOrderAndTradesForPersistence } from "../workers/trades-queue.js";
import { getRedisPublisher } from "../lib/redis.js";
import { REDIS_CHANNELS } from "../config/index.js";
import type { EngineOrder, ExecutedTrade } from "../types/order-book.js";

import { updateUserBalance } from "../services/user-balance.service.js";

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
    console.log("raw.price", raw.price);

    const prisma = getPrismaClient();
    const market = await prisma.market.findUnique({
      where: { id: raw.marketId },
      select: { id: true, outcomes: true, questionId: true, conditionId: true },
    });
    const resolvedMarket =
      market ??
      (await prisma.market.findFirst({
        where: { questionId: raw.marketId },
        select: { id: true, outcomes: true, questionId: true, conditionId: true },
      }));
    if (!resolvedMarket) return reply.code(404).send({ error: "Market not found" });
    const outcomes = resolvedMarket.outcomes as unknown[];
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
    if (isUserOrder && (!resolvedMarket.questionId || !resolvedMarket.conditionId)) {
      return reply.code(400).send({
        error: "Market has no questionId/conditionId; CRE execution requires them for user orders",
      });
    }

    const signedUserSignature = raw.userSignature?.trim();
    const signedTradeCostUsdc = raw.tradeCostUsdc?.trim();
    const signedNonce = raw.nonce?.trim();
    const signedDeadline = raw.deadline?.trim();
    const hasSignedQuoteFields = Boolean(
      signedUserSignature && signedTradeCostUsdc && signedNonce && signedDeadline
    );

    const isAgentMarketOrder = type === "MARKET" && agentId != null && agentId !== "";
    if (isAgentMarketOrder && !hasSignedQuoteFields) {
      return reply.code(400).send({
        error:
          "Agent MARKET orders require userSignature, tradeCostUsdc, nonce, and deadline for CRE execution",
      });
    }

    let crePayload: CreOrderPayload | AgentCrePayload | undefined;
    if (hasSignedQuoteFields && resolvedMarket.questionId && resolvedMarket.conditionId) {
      crePayload = {
        questionId: resolvedMarket.questionId,
        conditionId: resolvedMarket.conditionId,
        outcomeIndex: raw.outcomeIndex,
        buy: raw.side === "BID",
        quantity: raw.quantity as string,
        tradeCostUsdc: signedTradeCostUsdc as string,
        nonce: signedNonce as string,
        deadline: signedDeadline as string,
        userSignature: signedUserSignature as string,
      };
    } else if (agentId != null && agentId !== "" && raw.userSignature?.trim()) {
      crePayload = { userSignature: raw.userSignature.trim() };
    }

    const submittedPrice = raw.price != null && raw.price !== "" ? String(raw.price) : "0";
    const orderId = randomUUID();
    const chainKey = raw.chainKey ?? null;
    const input = {
      id: orderId,
      marketId: resolvedMarket.id,
      outcomeIndex: raw.outcomeIndex,
      side: raw.side,
      type,
      price: submittedPrice,
      quantity: raw.quantity,
      userId,
      agentId,
      crePayload: crePayload ?? null,
      chainKey,
    };

    if (type === "MARKET" && crePayload && "questionId" in crePayload) {
      try {
        const creResult = await executeUserMarketTradeOnCre(crePayload as CreOrderPayload, raw.side);
        if (!creResult.ok) {
          return reply.code(502).send({
            error: "CRE execution failed",
            message: creResult.error ?? "Unknown error",
          });
        }
        
        // Deduct from user wallet for successful trades
        if (creResult.ok && creResult.txHash && userId && raw.tradeCostUsdc) {
          try {
            await updateUserBalance({
              userId,
              tokenAddress: "0x039e2f66377121eFa1d9bB2aA7a765A7a7a7a7a7a", // USDC address - replace with actual
              amount: raw.tradeCostUsdc,
              operation: 'deduct',
              txHash: creResult.txHash,
              reason: 'Market trade execution',
            });
            console.log(`User wallet deducted: ${userId}, amount: ${raw.tradeCostUsdc}, txHash: ${creResult.txHash}`);
          } catch (balanceError) {
            console.error("Failed to deduct user balance:", balanceError);
            // Don't fail the trade, but log the issue
          }
        }
        
        const qtyDecimal = new Decimal(String(raw.quantity));
        const executedPrice = qtyDecimal.gt(0)
          ? new Decimal(crePayload.tradeCostUsdc).div(qtyDecimal).toString()
          : submittedPrice;
        const executedAt = Date.now();
        const tradeId = `trade-market-cre-${resolvedMarket.id}-${raw.outcomeIndex}-${executedAt}-${randomUUID().slice(0, 8)}`;
        const order: EngineOrder = {
          id: orderId,
          marketId: resolvedMarket.id,
          outcomeIndex: raw.outcomeIndex,
          side: raw.side,
          type: "MARKET",
          price: executedPrice,
          quantity: crePayload.quantity,
          remainingQty: "0",
          status: "FILLED",
          createdAt: executedAt,
          userId: userId ?? undefined,
          agentId: agentId ?? undefined,
          crePayload: crePayload ?? null,
          chainKey: chainKey ?? null,
        };
        const trade: ExecutedTrade = {
          id: tradeId,
          marketId: resolvedMarket.id,
          outcomeIndex: raw.outcomeIndex,
          price: executedPrice,
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
        await redis.publish(
          REDIS_CHANNELS.TRADES,
          JSON.stringify({
            trade,
            orderId: order.id,
            crePayload: order.crePayload ?? undefined,
            txHash: creResult.txHash ?? undefined,
          })
        );
        await redis.publish(REDIS_CHANNELS.MARKET_UPDATES, JSON.stringify({ marketId: resolvedMarket.id, reason: "orderbook" }));
        return reply.code(201).send({
          orderId,
          type: "MARKET",
          status: "FILLED",
          trades: [{ ...trade }],
          txHash: creResult.txHash,
          snapshot: {
            marketId: resolvedMarket.id,
            outcomeIndex: raw.outcomeIndex,
            bids: [],
            asks: [],
            timestamp: Date.now(),
          },
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
