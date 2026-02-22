/**
 * Fill MARKET order remainder from platform liquidity position when the book has insufficient depth.
 */

import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import type { EngineOrder, ExecutedTrade } from "../types/order-book.js";

const DECIMAL_PLACES = 18;

export interface PlatformFillResult {
  additionalTrades: ExecutedTrade[];
  updatedOrder: EngineOrder;
}

/**
 * Fill as much of the MARKET order's remaining quantity as possible from the platform's
 * LONG position (platform sells to a BID taker, or we don't fill ASK from platform in the same way -
 * for ASK taker, platform would need to buy; we only have LONG so we only sell).
 * So we only fill when order.side === "BID" (user buying; platform sells from LONG).
 * Returns additional trades and updated order (remainingQty and status).
 */
export async function fillMarketFromPlatform(
  marketId: string,
  outcomeIndex: number,
  order: EngineOrder,
  existingTrades: ExecutedTrade[],
  priceHint?: string
): Promise<PlatformFillResult> {
  if (order.type !== "MARKET" || order.side !== "BID") {
    return { additionalTrades: [], updatedOrder: order };
  }

  const address = config.platformLiquidityAddress;
  if (!address) return { additionalTrades: [], updatedOrder: order };

  const remaining = new Decimal(order.remainingQty);
  if (remaining.lte(0)) return { additionalTrades: [], updatedOrder: order };

  const prisma = getPrismaClient();
  const platformPosition = await prisma.position.findFirst({
    where: {
      marketId,
      outcomeIndex,
      address,
      side: "LONG",
      status: "OPEN",
    },
    select: { id: true, collateralLocked: true },
  });

  if (!platformPosition) return { additionalTrades: [], updatedOrder: order };
  const available = new Decimal(platformPosition.collateralLocked.toString());
  if (available.lte(0)) return { additionalTrades: [], updatedOrder: order };

  const fillableQty = Decimal.min(remaining, available).toFixed(DECIMAL_PLACES);
  const price =
    priceHint ?? (existingTrades.length > 0 ? existingTrades[existingTrades.length - 1].price : "0.5");
  const executedAt = Date.now();
  const tradeId = `trade-platform-${marketId}-${outcomeIndex}-${executedAt}-${randomUUID().slice(0, 8)}`;
  const makerOrderId = `platform-${marketId}-${outcomeIndex}`;

  const trade: ExecutedTrade = {
    id: tradeId,
    marketId,
    outcomeIndex,
    price,
    quantity: fillableQty,
    makerOrderId,
    takerOrderId: order.id,
    side: "BID",
    userId: order.userId ?? undefined,
    agentId: order.agentId ?? undefined,
    makerUserId: null,
    makerAgentId: null,
    executedAt,
  };

  const newRemaining = remaining.minus(fillableQty).toFixed(DECIMAL_PLACES);
  const updatedOrder: EngineOrder = {
    ...order,
    remainingQty: newRemaining,
    status: new Decimal(newRemaining).lte(0) ? "FILLED" : "PARTIALLY_FILLED",
  };

  return {
    additionalTrades: [trade],
    updatedOrder,
  };
}
