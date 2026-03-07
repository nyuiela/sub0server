/**
 * Persist CRE buy/sell callback into orders: find matching order(s) by questionId, outcomeIndex,
 * side, nonce, deadline and update crePayload with the callback body (txHash/txHashes, errors).
 * Broadcasts ORDER_CRE_PAYLOAD via Redis so frontend receives crePayload (including txHash).
 */

import type { PrismaClient } from "@prisma/client";
import type { CreBuySellCallbackInput } from "../schemas/cre-callback.schema.js";
import { getRedisPublisher } from "../lib/redis.js";
import { REDIS_CHANNELS } from "../config/index.js";

const CRE_CALLBACK_RETRY_MS = 3000;
const CRE_CALLBACK_RETRY_ATTEMPTS = 2;

export interface CreBuySellCallbackResult {
  updated: number;
  orderIds: string[];
  error?: string;
}

function buildCallbackPayload(body: CreBuySellCallbackInput): Record<string, unknown> {
  return {
    questionId: body.questionId,
    outcomeIndex: body.outcomeIndex,
    buy: body.buy,
    quantity: body.quantity,
    tradeCostUsdc: body.tradeCostUsdc,
    nonce: body.nonce,
    deadline: body.deadline,
    ...(body.users != null ? { users: body.users } : {}),
    ...(body.txHash != null ? { txHash: body.txHash } : {}),
    ...(body.txHashes != null && body.txHashes.length > 0 ? { txHashes: body.txHashes } : {}),
    ...(body.errors != null && body.errors.length > 0 ? { errors: body.errors } : {}),
  };
}

/**
 * Find orders matching the callback (market by questionId, outcomeIndex, side, and crePayload nonce/deadline),
 * then merge the callback payload into each order's crePayload and update.
 * Retries once after a short delay if no order matches (CRE may post before persistence job runs).
 */
export async function persistCreBuySellCallback(
  prisma: PrismaClient,
  body: CreBuySellCallbackInput,
  side: "BID" | "ASK"
): Promise<CreBuySellCallbackResult> {
  const market = await prisma.market.findFirst({
    where: { questionId: body.questionId.trim() },
    select: { id: true },
  });
  if (!market) {
    return { updated: 0, orderIds: [], error: "Market not found for questionId" };
  }

  const callbackPayload = buildCallbackPayload(body);

  for (let attempt = 0; attempt <= CRE_CALLBACK_RETRY_ATTEMPTS; attempt++) {
    const candidates = await prisma.order.findMany({
      where: {
        marketId: market.id,
        outcomeIndex: body.outcomeIndex,
        side,
      },
      select: { id: true, crePayload: true },
      orderBy: { updatedAt: "desc" },
    });

    const matching = candidates.filter((o) => {
      const p = o.crePayload as Record<string, unknown> | null;
      if (!p) return false;
      return p.nonce === body.nonce && p.deadline === body.deadline;
    });

    if (matching.length > 0) {
      const orderIds: string[] = [];
      const redis = await getRedisPublisher();
      for (const order of matching) {
        const existing = (order.crePayload as Record<string, unknown>) ?? {};
        const merged = { ...existing, ...callbackPayload };
        await prisma.order.update({
          where: { id: order.id },
          data: { crePayload: merged as object },
        });
        orderIds.push(order.id);
        await redis.publish(
          REDIS_CHANNELS.ORDER_CRE_PAYLOAD,
          JSON.stringify({
            orderId: order.id,
            marketId: market.id,
            outcomeIndex: body.outcomeIndex,
            side: body.buy ? "BID" : "ASK",
            crePayload: merged,
          })
        );
      }
      return { updated: orderIds.length, orderIds };
    }

    if (attempt < CRE_CALLBACK_RETRY_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, CRE_CALLBACK_RETRY_MS));
    }
  }

  return { updated: 0, orderIds: [], error: "No order found with matching nonce and deadline" };
}
