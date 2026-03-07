/**
 * Persist CRE buy/sell callback into orders: find matching order(s) by questionId, outcomeIndex,
 * side, nonce, deadline and update crePayload with the callback body (txHash/txHashes, errors).
 */

import type { PrismaClient } from "@prisma/client";
import type { CreBuySellCallbackInput } from "../schemas/cre-callback.schema.js";

export interface CreBuySellCallbackResult {
  updated: number;
  orderIds: string[];
  error?: string;
}

/**
 * Find orders matching the callback (market by questionId, outcomeIndex, side, and crePayload nonce/deadline),
 * then merge the callback payload into each order's crePayload and update.
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

  const candidates = await prisma.order.findMany({
    where: {
      marketId: market.id,
      outcomeIndex: body.outcomeIndex,
      side,
    },
    select: { id: true, crePayload: true },
    orderBy: { updatedAt: "desc" },
  });

  const callbackPayload: Record<string, unknown> = {
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

  const matching = candidates.filter((o) => {
    const p = o.crePayload as Record<string, unknown> | null;
    if (!p) return false;
    return p.nonce === body.nonce && p.deadline === body.deadline;
  });

  const orderIds: string[] = [];
  for (const order of matching) {
    const existing = (order.crePayload as Record<string, unknown>) ?? {};
    const merged = { ...existing, ...callbackPayload };
    await prisma.order.update({
      where: { id: order.id },
      data: { crePayload: merged as object },
    });
    orderIds.push(order.id);
  }

  return { updated: orderIds.length, orderIds };
}
