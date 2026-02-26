/**
 * Settlement types: two-agent deliberation, outcome array, rules.
 * Outcome array: index = outcome index, value = 1 (won) or 0 (lost).
 * e.g. Yes/No: [1,0]=Yes won, [0,1]=No won, [1,1]=both won, [0,0]=none won.
 */

/** Per-outcome result: 1 = won, 0 = lost. Same length as market outcomes. */
export type OutcomeArray = number[];

/** Single agent verdict: string answer plus outcome array. */
export interface SettlementVerdict {
  outcomeString: string;
  outcomeArray: OutcomeArray;
  confidence?: number;
  reason?: string;
}

/** Result of two-agent deliberation. */
export interface DeliberationResult {
  consensus: boolean;
  /** Agreed outcome array when consensus is true; otherwise undefined. */
  outcomeArray?: OutcomeArray;
  /** When consensus is false: agent A and B final verdicts and reasons. */
  agentA?: SettlementVerdict & { reason?: string };
  agentB?: SettlementVerdict & { reason?: string };
  /** Optional stored reasons for dispute (when consensus is false). */
  disputeReasons?: { agentA: string; agentB: string };
}

/** Payload for requesting a settlement verdict (question + optional rules). */
export interface SettlementRequestPayload {
  questionId: string;
  question: string;
  outcomes: string[];
  rules?: string | null;
}

/** Response from deliberation: can resolve when consensus and valid outcome array. */
export interface SettlementDeliberationResponse {
  canResolve: boolean;
  outcomeArray: OutcomeArray | null;
  outcomeString?: string;
  deliberation: DeliberationResult;
}
