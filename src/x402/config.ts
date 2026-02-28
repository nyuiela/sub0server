/**
 * x402 payment config for paid simulation (and future paid endpoints).
 * Chain and USDC are for Base Sepolia or Base mainnet; change chain id via env as needed.
 * Only bound to specific endpoints (e.g. POST /api/simulate/start); not applied to the whole backend.
 */

const optionalEnv = (key: string, fallback: string): string =>
  (process.env[key]?.trim() ?? fallback).trim();

/** Base Sepolia USDC (Circle). */
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** Base mainnet USDC (Circle). */
export const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export interface X402Config {
  /** Chain id for payment (e.g. 84532 Base Sepolia, 8453 Base mainnet). */
  chainId: number;
  /** USDC contract address on the payment chain. */
  usdcAddress: string;
  /** Address that receives simulation payments (must have valid checksum). */
  receiverAddress: string;
  /** Whether x402 is enabled (receiver set and chain configured). */
  enabled: boolean;
}

function getConfig(): X402Config {
  const chainIdRaw = optionalEnv("X402_CHAIN_ID", "84532");
  const chainId = Math.max(1, parseInt(chainIdRaw, 10) || 84532);
  const isMainnet = chainId === 8453;
  const usdcAddress = optionalEnv(
    "X402_USDC_ADDRESS",
    isMainnet ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA
  );
  const receiverAddress = optionalEnv("X402_RECEIVER_ADDRESS", "");
  return {
    chainId,
    usdcAddress,
    receiverAddress,
    enabled: receiverAddress.length > 0,
  };
}

let cached: X402Config | null = null;

export function getX402Config(): X402Config {
  if (cached === null) cached = getConfig();
  return cached;
}
