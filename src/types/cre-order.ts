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
