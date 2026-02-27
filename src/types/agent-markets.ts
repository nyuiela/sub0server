/**
 * Types for AI-generated agent market creation.
 * Payloads are compatible with Sub0 CRE createMarket HTTP body and backend Market create.
 */

/** Single market suggestion from the AI (question + optional params). */
export interface AgentMarketSuggestion {
  question: string;
  durationSeconds?: number;
  outcomeSlotCount?: number;
}

/** Which AI agent generated the market; stored on Market.agentSource, not exposed on public API. */
export type AgentSource = "gemini" | "grok" | "openwebui";

/**
 * Payload for CRE createMarket action (HTTP body).
 * Matches sub0cre markets workflow CreateMarketPayload and create-market-payload.json.
 */
export interface CreCreateMarketPayload {
  action: "createMarket";
  question: string;
  oracle: string;
  duration: number;
  outcomeSlotCount: number;
  oracleType: number;
  marketType: number;
  creatorAddress: string;
  /** Which agent generated this market; passed to onchain-created callback. */
  agentSource?: AgentSource;
  amountUsdc?: string;
  apiKey?: string;
}

/**
 * Payload for CRE createAgentKey action (GET query params or POST body).
 * CRE will later POST to /api/cre/agent-keys with the generated keys.
 */
export interface CreCreateAgentKeyPayload {
  action: "createAgentKey";
  agentId: string;
  funderNonce: number;
  apiKey?: string;
}

/**
 * Callback body when a market has been created on-chain (CRE or relayer calls backend).
 * Used to persist the market in the DB (conditionId = questionId).
 */
export interface OnchainMarketCreatedBody {
  questionId: string;
  createMarketTxHash: string;
  /** When liquidity was seeded for this market, the seed transaction hash. */
  seedTxHash?: string;
  question: string;
  oracle: string;
  creatorAddress: string;
  duration: number;
  outcomeSlotCount: number;
  oracleType: number;
  marketType: number;
  agentSource?: AgentSource;
}
