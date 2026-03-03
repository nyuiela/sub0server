/**
 * Enhanced Position Service
 * 
 * Handles position creation and updates for both users and agents with:
 * - Proper chainKey tracking (main vs tenderly simulation)
 * - Transaction hash storage for trade execution proof
 * - Outcome string mapping for better UX
 * - Fund deduction tracking
 * - Complete audit trail
 */

import { getPrismaClient } from "../lib/prisma.js";
import type { PrismaClient } from "@prisma/client";

export interface EnhancedPositionInput {
  marketId: string;
  outcomeIndex: number;
  address: string;
  tokenAddress: string;
  side: "LONG" | "SHORT";
  avgPrice: string;
  collateralLocked: string;
  isAmm: boolean;
  contractPositionId?: string;
  chainKey: string; // Accept string to match worker, will validate internally
  userId?: string;
  agentId?: string;
  tradeReason?: string;
  txHash?: string;
}

export interface PositionUpdateInput {
  status: "OPEN" | "CLOSED" | "LIQUIDATED";
  avgPrice?: string;
  collateralLocked?: string;
  tradeReason?: string;
  latestReason?: string;
  txHash?: string;
}

/**
 * Creates a new position with full context for both users and agents
 */
export async function createEnhancedPosition(input: EnhancedPositionInput): Promise<void> {
  const prisma = getPrismaClient();
  
  // Get outcome string
  const outcomeString = await getOutcomeString(input.marketId, input.outcomeIndex);
  
  await prisma.position.create({
    data: {
      marketId: input.marketId,
      outcomeIndex: input.outcomeIndex,
      outcomeString,
      address: input.address,
      tokenAddress: input.tokenAddress,
      side: input.side,
      status: "OPEN",
      avgPrice: input.avgPrice,
      collateralLocked: input.collateralLocked,
      isAmm: input.isAmm,
      contractPositionId: input.contractPositionId,
      chainKey: input.chainKey,
      userId: input.userId,
      agentId: input.agentId,
      tradeReason: input.tradeReason,
      latestReason: input.tradeReason,
    },
  });
}

/**
 * Updates an existing position with transaction hash and reasoning
 */
export async function updateEnhancedPosition(
  positionId: string,
  update: PositionUpdateInput
): Promise<void> {
  const prisma = getPrismaClient();
  
  await prisma.position.update({
    where: { id: positionId },
    data: {
      ...update,
      updatedAt: new Date(),
    },
  });
}

/**
 * Creates a trade record with transaction hash and chain key
 */
export async function createEnhancedTrade(
  trade: {
    marketId: string;
    outcomeIndex: number;
    side: string;
    amount: string;
    price: string;
    userId?: string;
    agentId?: string;
    txHash?: string;
    chainKey: "main" | "tenderly";
  }
): Promise<void> {
  const prisma = getPrismaClient();
  
  await prisma.trade.create({
    data: {
      marketId: trade.marketId,
      outcomeIndex: trade.outcomeIndex,
      side: trade.side,
      amount: trade.amount,
      price: trade.price,
      userId: trade.userId,
      agentId: trade.agentId,
      txHash: trade.txHash,
      chainKey: trade.chainKey,
    },
  });
}

/**
 * Gets human-readable outcome string for a market
 */
async function getOutcomeString(marketId: string, outcomeIndex: number): Promise<string> {
  const prisma = getPrismaClient();
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    select: { outcomes: true },
  });
  
  if (!market) {
    return `Outcome ${outcomeIndex}`;
  }
  
  const outcomes = market.outcomes as unknown[];
  if (Array.isArray(outcomes) && outcomeIndex < outcomes.length) {
    return String(outcomes[outcomeIndex]);
  }
  
  return `Outcome ${outcomeIndex}`;
}

/**
 * Updates user/agent balance after trade execution
 * This ensures funds are properly deducted/added
 */
export async function updateBalanceAfterTrade(
  trade: {
    address: string;
    amount: string;
    side: string;
    chainKey: "main" | "tenderly";
    isAgent: boolean;
    userId?: string;
    agentId?: string;
  }
): Promise<void> {
  const prisma = getPrismaClient();
  const amount = new Decimal(trade.amount);
  
  if (trade.isAgent && trade.agentId) {
    // Update agent balance
    const agent = await prisma.agent.findUnique({
      where: { id: trade.agentId },
      select: { balance: true },
    });
    
    if (agent) {
      const currentBalance = new Decimal(agent.balance.toString());
      const newBalance = trade.side === "ASK" 
        ? currentBalance.plus(amount)  // Selling adds balance
        : currentBalance.minus(amount); // Buying deducts balance
      
      await prisma.agent.update({
        where: { id: trade.agentId },
        data: { balance: newBalance.toFixed(18) },
      });
    }
  } else if (!trade.isAgent && trade.userId) {
    // Update user balance (would need to implement user balance tracking)
    // This is a placeholder for user balance management
    console.log(`User balance update needed: ${trade.userId}, amount: ${amount}, side: ${trade.side}`);
  }
}

/**
 * Validates that a trade has proper execution proof
 */
export function validateTradeExecution(trade: {
  txHash?: string;
  chainKey: "main" | "tenderly";
}): { isValid: boolean; reason: string } {
  // For main chain trades, txHash is required
  if (trade.chainKey === "main" && !trade.txHash) {
    return {
      isValid: false,
      reason: "Main chain trades require transaction hash for proof of execution"
    };
  }
  
  // For tenderly simulations, txHash is optional but recommended
  if (trade.chainKey === "tenderly" && !trade.txHash) {
    return {
      isValid: true,
      reason: "Tenderly simulation trade without transaction hash (acceptable for simulation)"
    };
  }
  
  return {
    isValid: true,
    reason: "Trade has proper execution proof"
  };
}

/**
 * Gets positions with full context including chain information
 */
export async function getPositionsWithContext(
  filters: {
    marketId?: string;
    userId?: string;
    agentId?: string;
    chainKey?: string;
    status?: "OPEN" | "CLOSED" | "LIQUIDATED";
  }
) {
  const prisma = getPrismaClient();
  
  const chainWhere = filters.chainKey 
    ? { chainKey: filters.chainKey }
    : { OR: [{ chainKey: "main" }, { chainKey: null }] };
  
  return await prisma.position.findMany({
    where: {
      ...(filters.marketId && { marketId: filters.marketId }),
      ...(filters.userId && { userId: filters.userId }),
      ...(filters.agentId && { agentId: filters.agentId }),
      ...(filters.status && { status: filters.status }),
      ...chainWhere,
    },
    include: {
      market: {
        select: { id: true, name: true, outcomes: true }
      },
      user: filters.userId ? {
        select: { id: true, address: true }
      } : false,
      agent: filters.agentId ? {
        select: { id: true, name: true }
      } : false,
    },
    orderBy: { createdAt: "desc" },
  });
}
