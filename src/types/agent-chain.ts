/**
 * Trading place / chain context for agent balance and enqueued markets.
 * Separates main chain (CHAIN_RPC_URL) from Tenderly simulate.
 */

export const CHAIN_KEY_MAIN = "main";
export const CHAIN_KEY_TENDERLY = "tenderly";

export type AgentChainKey = typeof CHAIN_KEY_MAIN | typeof CHAIN_KEY_TENDERLY;

export const AGENT_CHAIN_KEYS: AgentChainKey[] = [CHAIN_KEY_MAIN, CHAIN_KEY_TENDERLY];

export function isAgentChainKey(value: string): value is AgentChainKey {
  return value === CHAIN_KEY_MAIN || value === CHAIN_KEY_TENDERLY;
}
