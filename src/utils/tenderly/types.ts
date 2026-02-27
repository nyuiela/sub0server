/**
 * Types for Tenderly Virtual TestNet (simulate sandbox) chain configuration.
 * Used for agent back-testing and sandbox trading, separate from production (e.g. Base Sepolia).
 */

export interface NativeCurrencyConfig {
  name: string;
  symbol: string;
  decimals: number;
}

export interface TenderlyChainConfig {
  chainId: number;
  name: string;
  /** Public RPC URL for reads and sending signed transactions. */
  rpcUrl: string;
  /** Admin RPC URL for tenderly_setBalance, tenderly_setErc20Balance, etc. Must be kept server-side only. */
  adminRpcUrl: string;
  /** WebSocket URL for live balance/block updates (e.g. eth_subscribe). */
  wsUrl?: string;
  blockExplorerUrl?: string;
  nativeCurrency: NativeCurrencyConfig;
  /** USDC (or custom stable) contract address on this chain for simulate funding. */
  usdcAddress: string;
}

export interface TenderlyContractAddresses {
  /** Contract used to execute trades on the simulate chain (e.g. prediction market / vault). */
  tradeExecutor?: string;
  /** Optional: approval/spender for USDC. */
  usdcSpender?: string;
  [key: string]: string | undefined;
}

export interface TenderlySimulateConfig {
  chain: TenderlyChainConfig;
  contracts: TenderlyContractAddresses;
}
