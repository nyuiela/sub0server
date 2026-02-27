/**
 * Execute trades via CRE: user path (quote/order with userSignature) and agent path (executeConfidentialTrade).
 * Used when orders from the fill pool are filled so CRE can submit executeTrade on-chain.
 */

import { config } from "../config/index.js";
import type { CreOrderPayload } from "../types/cre-order.js";

const CRE_ORDER_ACTION = "order";

export interface CreExecuteUserResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

export interface CreExecuteAgentPayload {
  agentId: string;
  questionId: string;
  outcomeIndex: number;
  buy: boolean;
  quantity: string;
  tradeCostUsdc: string;
  nonce: string;
  deadline: string;
}

export interface CreExecuteAgentResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

async function postToCre(body: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = config.creHttpUrl?.trim();
  if (!url) return { ok: false, error: "CRE_HTTP_URL not set" };
  const apiKey = config.creHttpApiKey?.trim();
  if (apiKey) body.apiKey = apiKey;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `CRE ${res.status}: ${text.slice(0, 200)}` };
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "CRE response not JSON" };
    }
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Execute one trade on CRE with user's EIP-712 signature. CRE adds DON signature and submits executeTrade.
 */
export async function executeUserTradeOnCre(payload: CreOrderPayload): Promise<CreExecuteUserResult> {
  const body: Record<string, unknown> = {
    action: CRE_ORDER_ACTION,
    questionId: payload.questionId,
    conditionId: payload.conditionId,
    outcomeIndex: payload.outcomeIndex,
    buy: payload.buy,
    quantity: payload.quantity,
    tradeCostUsdc: payload.tradeCostUsdc,
    nonce: payload.nonce,
    deadline: payload.deadline,
    userSignature: payload.userSignature,
  };
  const result = await postToCre(body);
  if (!result.ok) return { ok: false, error: result.error };
  const data = result.data as { txHash?: string } | undefined;
  const txHash = typeof data?.txHash === "string" ? data.txHash : undefined;
  return { ok: true, txHash };
}

/**
 * Execute one trade on CRE with agent key (executeConfidentialTrade). CRE signs with agent + DON and submits.
 */
export async function executeAgentTradeOnCre(payload: CreExecuteAgentPayload): Promise<CreExecuteAgentResult> {
  const body: Record<string, unknown> = {
    action: "executeConfidentialTrade",
    agentId: payload.agentId,
    questionId: payload.questionId,
    outcomeIndex: payload.outcomeIndex,
    buy: payload.buy,
    quantity: payload.quantity,
    tradeCostUsdc: payload.tradeCostUsdc,
    nonce: payload.nonce,
    deadline: payload.deadline,
  };
  const result = await postToCre(body);
  if (!result.ok) return { ok: false, error: result.error };
  const data = result.data as { txHash?: string } | undefined;
  const txHash = typeof data?.txHash === "string" ? data.txHash : undefined;
  return { ok: true, txHash };
}
