/**
 * Enhanced CRE Integration Service
 * 
 * Handles CRE integration with proper chainKey support, transaction tracking,
 * and fund deduction for both users and agents.
 */

import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { executeUserTradeOnCre, executeAgentTradeOnCre, type CreExecuteUserResult, type CreExecuteAgentResult } from "./cre-execute-trade.service.js";
import { createEnhancedTrade, updateBalanceAfterTrade, validateTradeExecution } from "./enhanced-position-service.js";

export interface EnhancedCreTradePayload {
  marketId: string;
  questionId: string;
  conditionId: string;
  outcomeIndex: number;
  buy: boolean;
  quantity: string;
  tradeCostUsdc: string;
  nonce: string;
  deadline: string;
  chainKey: "main" | "tenderly";
  userId?: string;
  agentId?: string;
  userSignature?: string;
}

export interface CreTradeResult {
  success: boolean;
  txHash?: string;
  error?: string;
  chainKey: "main" | "tenderly";
  fundsDeducted: boolean;
  tradeRecordId?: string;
}

/**
 * Executes a trade via CRE with proper chainKey handling and fund tracking
 */
export async function executeEnhancedCreTrade(payload: EnhancedCreTradePayload): Promise<CreTradeResult> {
  const prisma = getPrismaClient();
  const isAgent = !!payload.agentId;
  const isSimulation = payload.chainKey === "tenderly";
  
  try {
    // Step 1: Execute trade via CRE
    let creResult: CreExecuteUserResult | CreExecuteAgentResult;
    
    if (isAgent) {
      creResult = await executeAgentTradeOnCre({
        agentId: payload.agentId!,
        questionId: payload.questionId,
        outcomeIndex: payload.outcomeIndex,
        buy: payload.buy,
        quantity: payload.quantity,
        tradeCostUsdc: payload.tradeCostUsdc,
        nonce: payload.nonce,
        deadline: payload.deadline,
      });
    } else {
      creResult = await executeUserTradeOnCre({
        questionId: payload.questionId,
        conditionId: payload.conditionId,
        outcomeIndex: payload.outcomeIndex,
        buy: payload.buy,
        quantity: payload.quantity,
        tradeCostUsdc: payload.tradeCostUsdc,
        nonce: payload.nonce,
        deadline: payload.deadline,
        userSignature: payload.userSignature!,
      });
    }
    
    if (!creResult.ok) {
      return {
        success: false,
        error: creResult.error,
        chainKey: payload.chainKey,
        fundsDeducted: false,
      };
    }
    
    // Step 2: Validate trade execution
    const validation = validateTradeExecution({
      txHash: creResult.txHash,
      chainKey: payload.chainKey,
    });
    
    if (!validation.isValid && payload.chainKey === "main") {
      return {
        success: false,
        error: `Trade validation failed: ${validation.reason}`,
        chainKey: payload.chainKey,
        fundsDeducted: false,
      };
    }
    
    // Step 3: Create trade record
    await createEnhancedTrade({
      marketId: payload.marketId,
      outcomeIndex: payload.outcomeIndex,
      side: payload.buy ? "BID" : "ASK",
      amount: payload.quantity,
      price: payload.tradeCostUsdc, // This might need adjustment based on actual price
      userId: payload.userId,
      agentId: payload.agentId,
      txHash: creResult.txHash,
      chainKey: payload.chainKey,
    });
    
    // Step 4: Update balances (for main chain only)
    let fundsDeducted = false;
    if (payload.chainKey === "main" && creResult.txHash) {
      try {
        await updateBalanceAfterTrade({
          address: await getAddress(payload.userId, payload.agentId),
          amount: payload.quantity,
          side: payload.buy ? "BID" : "ASK",
          chainKey: payload.chainKey,
          isAgent,
          userId: payload.userId,
          agentId: payload.agentId,
        });
        fundsDeducted = true;
      } catch (balanceError) {
        console.error("Balance update failed:", balanceError);
        // Don't fail the trade, but log the issue
      }
    }
    
    // Step 5: For simulations, log that no actual funds were deducted
    if (payload.chainKey === "tenderly") {
      console.log(`Simulation trade executed: ${payload.agentId || payload.userId} - No actual funds deducted`);
    }
    
    return {
      success: true,
      txHash: creResult.txHash,
      chainKey: payload.chainKey,
      fundsDeducted,
    };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `CRE execution failed: ${message}`,
      chainKey: payload.chainKey,
      fundsDeducted: false,
    };
  }
}

/**
 * Gets address for user or agent
 */
async function getAddress(userId?: string, agentId?: string): Promise<string> {
  const prisma = getPrismaClient();
  
  if (agentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { walletAddress: true, publicKey: true },
    });
    return agent?.walletAddress || agent?.publicKey || "unknown";
  }
  
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { address: true },
    });
    return user?.address || "unknown";
  }
  
  return "unknown";
}

/**
 * Gets CRE configuration for different chain keys
 */
export function getCreConfig(chainKey: "main" | "tenderly") {
  const baseConfig = {
    httpUrl: config.creHttpUrl,
    apiKey: config.creHttpApiKey,
  };
  
  if (chainKey === "tenderly") {
    // For simulation, we might use different contract addresses
    // This is where you'd configure tenderly-specific settings
    return {
      ...baseConfig,
      // Add tenderly-specific configuration here
      simulationMode: true,
      // Note: CRE doesn't currently support tenderly, but this prepares for future support
    };
  }
  
  return {
    ...baseConfig,
    simulationMode: false,
  };
}

/**
 * Validates that CRE is properly configured for the given chainKey
 */
export function validateCreConfiguration(chainKey: "main" | "tenderly"): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  if (!config.creHttpUrl?.trim()) {
    issues.push("CRE_HTTP_URL not configured");
  }
  
  if (!config.creHttpApiKey?.trim()) {
    issues.push("CRE_HTTP_API_KEY not configured");
  }
  
  if (chainKey === "tenderly") {
    issues.push("CRE does not currently support Tenderly simulation - trades will fail");
  }
  
  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Gets transaction status from CRE (if available)
 */
export async function getCreTransactionStatus(txHash: string, chainKey: "main" | "tenderly"): Promise<{
  status: "pending" | "confirmed" | "failed" | "unknown";
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
}> {
  // This would be implemented when CRE provides transaction status API
  // For now, return a placeholder
  return {
    status: "unknown",
    error: "Transaction status API not yet implemented in CRE",
  };
}

/**
 * Handles CRE callback results for trade confirmation
 */
export async function handleCreTradeCallback(callbackData: {
  txHash: string;
  status: "success" | "failed";
  chainKey: "main" | "tenderly";
  marketId: string;
  agentId?: string;
  userId?: string;
  error?: string;
}): Promise<void> {
  const prisma = getPrismaClient();
  
  // Update trade record with callback status
  await prisma.trade.updateMany({
    where: {
      txHash: callbackData.txHash,
      marketId: callbackData.marketId,
      ...(callbackData.agentId && { agentId: callbackData.agentId }),
      ...(callbackData.userId && { userId: callbackData.userId }),
    },
    data: {
      // Add callback status field if needed in schema
      // For now, we could use a separate table or add fields to Trade model
    },
  });
  
  // Log the callback for debugging
  console.log(`CRE callback received: ${callbackData.txHash} - ${callbackData.status} (${callbackData.chainKey})`);
  
  if (callbackData.status === "failed" && callbackData.error) {
    console.error(`CRE trade failed: ${callbackData.error}`);
    // Here you could implement rollback logic or notification system
  }
}
