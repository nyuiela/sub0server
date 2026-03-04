/**
 * CRE LMSR Pricing Service
 *
 * Handles requesting LMSR pricing quotes from CRE and broadcasting results via WebSocket.
 * CRE sends a callback to /api/cre/lmsr-pricing with the signed pricing data.
 */

import { config } from "../config/index.js";
import { getRedisPublisher } from "../lib/redis.js";
import { REDIS_CHANNELS } from "../config/index.js";
import type { LMSRPricingPayload, LMSRPricingResult } from "../types/lmsr.js";

export interface CreLmsrPricingRequest {
  marketId: string;
  questionId: string;
  outcomeIndex: number;
  quantity: string;
  bParameter: string;
  userId?: string;
  agentId?: string;
  requestId: string;
}

export interface CreLmsrPricingResponse {
  success: boolean;
  requestId: string;
  error?: string;
}

// Track pending pricing requests
const pendingRequests = new Map<string, {
  userId?: string;
  agentId?: string;
  marketId: string;
  timeout: ReturnType<typeof setTimeout>;
}>();

/**
 * Request LMSR pricing from CRE
 * This sends a payload to the CRE HTTP endpoint and waits for callback
 */
export async function requestLmsrPricingFromCre(
  request: CreLmsrPricingRequest
): Promise<CreLmsrPricingResponse> {
  if (!config.creHttpUrl?.trim()) {
    return {
      success: false,
      requestId: request.requestId,
      error: "CRE_HTTP_URL not configured",
    };
  }

  try {
    // Build CRE payload
    const crePayload: LMSRPricingPayload = {
      action: "lmsrPricing",
      apiKey: config.creHttpApiKey ?? "",
      marketId: request.questionId, // CRE uses questionId as marketId
      outcomeIndex: request.outcomeIndex,
      quantity: request.quantity,
      bParameter: request.bParameter,
      // Include metadata for callback routing
      metadata: {
        backendMarketId: request.marketId,
        userId: request.userId,
        agentId: request.agentId,
        requestId: request.requestId,
      },
    };

    // Send to CRE
    const response = await fetch(config.creHttpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(crePayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        requestId: request.requestId,
        error: `CRE request failed: ${response.status} - ${errorText.slice(0, 200)}`,
      };
    }

    // Track pending request
    const timeout = setTimeout(() => {
      pendingRequests.delete(request.requestId);
    }, 30000); // 30 second timeout

    pendingRequests.set(request.requestId, {
      userId: request.userId,
      agentId: request.agentId,
      marketId: request.marketId,
      timeout,
    });

    return {
      success: true,
      requestId: request.requestId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      requestId: request.requestId,
      error: `Failed to request pricing: ${message}`,
    };
  }
}

/**
 * Handle CRE LMSR pricing callback
 * This is called when CRE sends the pricing result back to /api/cre/lmsr-pricing
 */
export async function handleCreLmsrPricingCallback(
  result: LMSRPricingResult
): Promise<void> {
  // Get pending request info
  const pending = pendingRequests.get(result.requestId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingRequests.delete(result.requestId);
  }

  // Validate the result
  if (!result.marketId || !result.tradeCostUsdc) {
    console.error("Invalid LMSR pricing callback:", result);
    return;
  }

  // Broadcast via Redis for WebSocket distribution
  const pub = await getRedisPublisher();

  // Broadcast to market room (public pricing update)
  await pub.publish(
    REDIS_CHANNELS.LMSR_PRICING,
    JSON.stringify({
      type: "LMSR_PRICING_UPDATE",
      payload: {
        marketId: result.metadata?.backendMarketId ?? result.marketId,
        questionId: result.marketId,
        outcomeIndex: result.outcomeIndex,
        quantity: result.quantity,
        tradeCostUsdc: result.tradeCostUsdc,
        deadline: result.deadline,
        nonce: result.nonce,
        donSignature: result.donSignature,
        requestId: result.requestId,
        timestamp: new Date().toISOString(),
      },
      // Send to specific user if this was a user request
      userId: result.metadata?.userId,
      agentId: result.metadata?.agentId,
    })
  );

  console.log(`LMSR pricing broadcast for market ${result.marketId}: ${result.tradeCostUsdc} USDC`);
}

/**
 * Get pending request info (for checking if a request is still pending)
 */
export function getPendingPricingRequest(requestId: string) {
  return pendingRequests.get(requestId);
}

/**
 * Cancel a pending pricing request
 */
export function cancelPendingPricingRequest(requestId: string): boolean {
  const pending = pendingRequests.get(requestId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingRequests.delete(requestId);
    return true;
  }
  return false;
}

/**
 * Clean up all pending requests (use on shutdown)
 */
export function cleanupPendingPricingRequests(): void {
  for (const [requestId, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    pendingRequests.delete(requestId);
  }
}
