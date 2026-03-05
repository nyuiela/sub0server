/**
 * Payload stored with user orders for CRE execution on fill.
 * CRE quote/order expects: questionId, conditionId, outcomeIndex, buy, quantity,
 * tradeCostUsdc, nonce, deadline, userSignature.
 */
export interface CreOrderPayload {
  questionId: string;
  conditionId: string;
  outcomeIndex: number;
  buy: boolean;
  quantity: string;
  tradeCostUsdc: string;
  nonce: string;
  deadline: string;
  userSignature: string;
}

/**
 * Payload stored with agent orders. Same EIP-712 UserTrade signature as user;
 * CRE receives it as userSignature when calling executeConfidentialTrade/order.
 * Only the signature is stored at submit time; tradeCostUsdc/nonce/deadline are
 * computed at fill time in the persistence worker.
 */
export interface AgentCrePayload {
  userSignature: string;
}
