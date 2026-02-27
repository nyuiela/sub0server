/**
 * Tenderly Virtual TestNet chain configuration for the simulate sandbox.
 * Not a single-file config: chain definition here, contracts in contracts.ts, funding in funding.ts.
 */

import type { TenderlyChainConfig, NativeCurrencyConfig } from "./types.js";
import { getTenderlyContractAddresses } from "./contracts.js";

const optionalEnv = (key: string, fallback: string): string =>
  process.env[key]?.trim() ?? fallback;

function getNativeCurrency(): NativeCurrencyConfig {
  const name = optionalEnv("TENDERLY_NATIVE_CURRENCY_NAME", "Ether");
  const symbol = optionalEnv("TENDERLY_NATIVE_CURRENCY_SYMBOL", "ETH");
  const decimals = Math.max(0, Math.min(18, Number(optionalEnv("TENDERLY_NATIVE_DECIMALS", "18"))));
  return { name, symbol, decimals };
}

/**
 * Returns the chain config for the simulate environment.
 * Requires TENDERLY_VIRTUAL_TESTNET_RPC (public) and TENDERLY_VIRTUAL_TESTNET_ADMIN_RPC (admin).
 */
export function getTenderlyChainConfig(): TenderlyChainConfig | null {
  const rpcUrl = process.env.TENDERLY_VIRTUAL_TESTNET_RPC?.trim();
  const adminRpcUrl = process.env.TENDERLY_VIRTUAL_TESTNET_ADMIN_RPC?.trim();
  if (!rpcUrl || !adminRpcUrl) return null;

  const chainId = Number(process.env.TENDERLY_CHAIN_ID?.trim() || "0") || 73571;
  const name = optionalEnv("TENDERLY_CHAIN_NAME", "Virtual TestNet");
  const wsUrl = process.env.TENDERLY_VIRTUAL_TESTNET_WS?.trim() || undefined;
  const blockExplorerUrl = process.env.TENDERLY_EXPLORER_URL?.trim() || undefined;
  const usdcAddress =
    process.env.TENDERLY_USDC_ADDRESS?.trim() ||
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  return {
    chainId,
    name,
    rpcUrl,
    adminRpcUrl,
    wsUrl,
    blockExplorerUrl,
    nativeCurrency: getNativeCurrency(),
    usdcAddress,
  };
}

/**
 * Full simulate config: chain + contract addresses.
 */
export function getTenderlySimulateConfig(): {
  chain: TenderlyChainConfig;
  contracts: ReturnType<typeof getTenderlyContractAddresses>;
} | null {
  const chain = getTenderlyChainConfig();
  if (!chain) return null;
  return {
    chain,
    contracts: getTenderlyContractAddresses(),
  };
}
