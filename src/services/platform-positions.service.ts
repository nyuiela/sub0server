/**
 * Platform liquidity: create and manage positions held by the platform to fill MARKET orders.
 * When PLATFORM_LIQUIDITY_ADDRESS is set, we create one LONG position per outcome on market create.
 */

import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";

/**
 * Create one LONG position per outcome for the platform so it can sell to MARKET buyers.
 * No-op if PLATFORM_LIQUIDITY_ADDRESS is not set.
 */
export async function createPlatformPositionsForMarket(
  marketId: string,
  outcomeCount: number,
  collateralToken: string,
  outcomePositionIds: string[] | null
): Promise<void> {
  const address = config.platformLiquidityAddress;
  if (!address) return;

  const prisma = getPrismaClient();
  const initialQty = String(config.platformInitialLiquidityPerOutcome);
  const now = new Date();

  for (let outcomeIndex = 0; outcomeIndex < outcomeCount; outcomeIndex++) {
    const contractPositionId =
      Array.isArray(outcomePositionIds) && outcomeIndex < outcomePositionIds.length
        ? outcomePositionIds[outcomeIndex] ?? null
        : null;

    await prisma.position.create({
      data: {
        marketId,
        outcomeIndex,
        address,
        userId: null,
        agentId: null,
        tokenAddress: collateralToken,
        contractPositionId,
        side: "LONG",
        status: "OPEN",
        avgPrice: "0.5",
        collateralLocked: initialQty,
        isAmm: false,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}
