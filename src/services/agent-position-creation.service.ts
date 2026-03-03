/**
 * Agent Position Creation Service
 * 
 * This service bridges the gap between agent trading decisions and position management.
 * It ensures that when an agent decides to trade, a position is created with:
 * - Proper reasoning from the agent's decision
 * - Outcome string mapping (not just index)
 * - Correct side (LONG/SHORT) based on decision
 * - Proper status tracking
 */

import { getPrismaClient } from "../lib/prisma.js";
import type { TradingDecision } from "./agent-trading-analysis.service.js";
import type { AgentMarketContext } from "./agent-trading-analysis.service.js";

export interface AgentPositionCreationInput {
  agentId: string;
  marketId: string;
  decision: TradingDecision;
  marketContext: AgentMarketContext;
  chainKey?: string;
}

export interface AgentPositionUpdateInput {
  agentId: string;
  marketId: string;
  outcomeIndex: number;
  newStatus: "OPEN" | "CLOSED" | "LIQUIDATED";
  reason?: string;
  chainKey?: string;
}

/**
 * Creates or updates a position based on agent's trading decision
 */
export async function createOrUpdateAgentPosition(input: AgentPositionCreationInput): Promise<void> {
  const { agentId, marketId, decision, marketContext, chainKey = "main" } = input;
  
  if (decision.action === "skip") {
    // Skip means hold - no position change needed
    return;
  }

  const prisma = getPrismaClient();
  const outcomeIndex = decision.outcomeIndex ?? 0;
  const outcomeString = marketContext.outcomes[outcomeIndex] ?? `Outcome ${outcomeIndex}`;
  
  // Determine side based on action
  const side = decision.action === "buy" ? "LONG" : "SHORT";
  
  // Get market info for contract details
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: { 
      collateralToken: true, 
      outcomePositionIds: true,
      status: true 
    },
  });
  
  if (!market) {
    throw new Error(`Market ${marketId} not found`);
  }

  const outcomePositionIds = market.outcomePositionIds as string[] | null;
  const contractPositionId = Array.isArray(outcomePositionIds) && outcomeIndex < outcomePositionIds.length
    ? outcomePositionIds[outcomeIndex] ?? null
    : null;

  const positionWhereChain = chainKey === "main" 
    ? { OR: [{ chainKey: "main" }, { chainKey: null }] }
    : { chainKey };

  // Check for existing position
  const existingPosition = await prisma.position.findFirst({
    where: {
      agentId,
      marketId,
      outcomeIndex,
      ...positionWhereChain,
    },
    select: {
      id: true,
      side: true,
      status: true,
      collateralLocked: true,
      avgPrice: true,
    },
  });

  const reason = decision.reason?.slice(0, 2000) ?? "No reason provided";
  const quantity = decision.quantity ?? "1";

  if (decision.action === "buy") {
    // Buy action: Create or update LONG position
    if (existingPosition && existingPosition.side === "LONG") {
      // Update existing LONG position
      const newLocked = existingPosition.collateralLocked.plus(quantity);
      await prisma.position.update({
        where: { id: existingPosition.id },
        data: {
          status: "OPEN",
          collateralLocked: newLocked,
          tradeReason: reason,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new LONG position
      await prisma.position.create({
        data: {
          agentId,
          marketId,
          outcomeIndex,
          address: await getAgentAddress(agentId),
          tokenAddress: market.collateralToken,
          contractPositionId,
          side: "LONG",
          status: "OPEN",
          avgPrice: "0", // Will be updated when trade executes
          collateralLocked: quantity,
          isAmm: false,
          chainKey,
          tradeReason: reason,
        },
      });
    }
  } else if (decision.action === "sell") {
    // Sell action: Close LONG position or open SHORT position
    if (existingPosition && existingPosition.side === "LONG") {
      // Close existing LONG position
      await prisma.position.update({
        where: { id: existingPosition.id },
        data: {
          status: "CLOSED",
          tradeReason: reason,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create SHORT position
      await prisma.position.create({
        data: {
          agentId,
          marketId,
          outcomeIndex,
          address: await getAgentAddress(agentId),
          tokenAddress: market.collateralToken,
          contractPositionId,
          side: "SHORT",
          status: "OPEN",
          avgPrice: "0",
          collateralLocked: quantity,
          isAmm: false,
          chainKey,
          tradeReason: reason,
        },
      });
    }
  }
}

/**
 * Updates position status with agent reasoning
 */
export async function updateAgentPositionStatus(input: AgentPositionUpdateInput): Promise<void> {
  const { agentId, marketId, outcomeIndex, newStatus, reason, chainKey = "main" } = input;
  
  const prisma = getPrismaClient();
  const positionWhereChain = chainKey === "main" 
    ? { OR: [{ chainKey: "main" }, { chainKey: null }] }
    : { chainKey };

  await prisma.position.updateMany({
    where: {
      agentId,
      marketId,
      outcomeIndex,
      ...positionWhereChain,
    },
    data: {
      status: newStatus,
      tradeReason: reason?.slice(0, 2000) ?? null,
      updatedAt: new Date(),
    },
  });
}

/**
 * Gets agent's wallet address
 */
async function getAgentAddress(agentId: string): Promise<string> {
  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { walletAddress: true, publicKey: true },
  });
  
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }
  
  return agent.walletAddress?.trim() || agent.publicKey?.trim() || "unknown";
}

/**
 * Enriches position queries with outcome strings and latest reasoning
 */
export async function enrichPositionsWithContext(
  positions: Array<{
    id: string;
    marketId: string;
    outcomeIndex: number;
    agentId?: string;
  }>,
  includeLatestReason: boolean = false
): Promise<Array<{
  outcomeString?: string;
  latestReason?: string;
}>> {
  const prisma = getPrismaClient();
  const marketIds = [...new Set(positions.map(p => p.marketId))];
  const agentIds = [...new Set(positions.filter(p => p.agentId).map(p => p.agentId!))];

  // Get market outcomes
  const markets = await prisma.market.findMany({
    where: { id: { in: marketIds } },
    select: { id: true, outcomes: true },
  });

  const marketOutcomesMap = new Map(
    markets.map(m => [m.id, m.outcomes as unknown[]])
  );

  // Get latest agent reasoning if requested
  let latestReasonsMap = new Map<string, string>();
  if (includeLatestReason && agentIds.length > 0) {
    const enqueuedMarkets = await prisma.agentEnqueuedMarket.findMany({
      where: {
        agentId: { in: agentIds },
        marketId: { in: marketIds },
        status: { in: ["TRADED", "DISCARDED"] },
      },
      select: {
        agentId: true,
        marketId: true,
        tradeReason: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    latestReasonsMap = new Map(
      enqueuedMarkets.map(em => [`${em.agentId}-${em.marketId}`, em.tradeReason])
    );
  }

  return positions.map(position => {
    const outcomes = marketOutcomesMap.get(position.marketId) || [];
    const outcomeString = Array.isArray(outcomes) && position.outcomeIndex < outcomes.length
      ? String(outcomes[position.outcomeIndex])
      : `Outcome ${position.outcomeIndex}`;

    const latestReason = position.agentId 
      ? latestReasonsMap.get(`${position.agentId}-${position.marketId}`)
      : undefined;

    return {
      outcomeString,
      latestReason,
    };
  });
}
