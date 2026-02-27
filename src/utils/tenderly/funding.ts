/**
 * Tenderly simulate wallet funding via Admin RPC.
 * First request: tenderly_setBalance + tenderly_setErc20Balance (exact amounts).
 * Later requests (after cooldown): tenderly_addBalance + tenderly_addErc20Balance so we
 * add to existing balances instead of overwriting. Limited to once per week per user/agent.
 */

import type { TenderlyChainConfig } from "./types.js";
import { getTenderlyChainConfig } from "./chainConfig.js";

const ETH_FUND_AMOUNT_WEI = BigInt("100000000000000000"); // 0.1 ETH
const USDC_FUND_AMOUNT_UNITS = BigInt(20_000 * 1_000_000); // 20_000 USDC (6 decimals)
const REQUEST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface FundingResult {
  success: boolean;
  nativeTxHash?: string;
  usdcTxHash?: string;
  error?: string;
}

export interface FundingEligibility {
  eligible: boolean;
  firstTime: boolean;
  nextRequestAt?: number;
  reason?: string;
}

const lastRequestByKey = new Map<string, number>();

function fundingKey(ownerId: string, agentId: string): string {
  return `simulate-fund:${ownerId}:${agentId}`;
}

function toHex(value: bigint): string {
  return "0x" + value.toString(16);
}

async function adminRequest<T>(
  adminRpcUrl: string,
  method: string,
  params: unknown[]
): Promise<T> {
  const res = await fetch(adminRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  if (!res.ok) {
    throw new Error(`Tenderly Admin RPC HTTP ${res.status}`);
  }
  const data = (await res.json()) as { error?: { message?: string }; result?: T };
  if (data.error?.message) {
    throw new Error(data.error.message);
  }
  return data.result as T;
}

/**
 * Set native balance for one or more addresses (replaces balance).
 * Uses tenderly_setBalance. Amount in wei.
 */
export async function setBalance(
  adminRpcUrl: string,
  addresses: string[],
  amountWei: bigint
): Promise<string> {
  const hexAmount = toHex(amountWei);
  const result = await adminRequest<string>(
    adminRpcUrl,
    "tenderly_setBalance",
    [addresses, hexAmount]
  );
  return result ?? "";
}

/**
 * Set ERC20 balance for a single wallet on the given token contract.
 * Uses tenderly_setErc20Balance. Value in token smallest units (e.g. 6 decimals for USDC).
 */
export async function setErc20Balance(
  adminRpcUrl: string,
  tokenAddress: string,
  walletAddress: string,
  valueUnits: bigint
): Promise<string> {
  const hexValue = toHex(valueUnits);
  const result = await adminRequest<string>(
    adminRpcUrl,
    "tenderly_setErc20Balance",
    [tokenAddress, walletAddress, hexValue]
  );
  return result ?? "";
}

/**
 * Add native balance to one or more addresses (Tenderly Admin RPC).
 */
export async function addBalance(
  adminRpcUrl: string,
  addresses: string[],
  amountWei: bigint
): Promise<string> {
  const hexAmount = toHex(amountWei);
  const result = await adminRequest<string>(
    adminRpcUrl,
    "tenderly_addBalance",
    [addresses, hexAmount]
  );
  return result ?? "";
}

/**
 * Add ERC20 balance to a wallet (Tenderly Admin RPC). Value in token smallest units.
 * Params: token address, array of wallet addresses, hex value.
 */
export async function addErc20Balance(
  adminRpcUrl: string,
  tokenAddress: string,
  walletAddress: string,
  valueUnits: bigint
): Promise<string> {
  const hexValue = toHex(valueUnits);
  const result = await adminRequest<string>(
    adminRpcUrl,
    "tenderly_addErc20Balance",
    [tokenAddress, [walletAddress], hexValue]
  );
  return result ?? "";
}

/**
 * Check if the wallet is eligible for a funding request.
 * First time = eligible without cooldown. After that, once per week.
 * Pass lastRequestAt from Redis (or other store) when available; otherwise in-memory state is used.
 */
export function checkFundingEligibility(
  ownerId: string,
  agentId: string,
  lastRequestAt?: number | null
): FundingEligibility {
  const key = fundingKey(ownerId, agentId);
  const last =
    lastRequestAt !== undefined && lastRequestAt !== null
      ? lastRequestAt
      : lastRequestByKey.get(key);
  if (last == null) {
    return { eligible: true, firstTime: true };
  }
  const nextAllowed = last + REQUEST_COOLDOWN_MS;
  if (Date.now() >= nextAllowed) {
    return { eligible: true, firstTime: false };
  }
  return {
    eligible: false,
    firstTime: false,
    nextRequestAt: nextAllowed,
    reason: "Requesting test tokens (funding) is limited to once per week. Running simulations is always allowed.",
  };
}

/**
 * Record that a funding request was made (call after successful fund).
 */
export function recordFundingRequest(ownerId: string, agentId: string): void {
  lastRequestByKey.set(fundingKey(ownerId, agentId), Date.now());
}

/**
 * Fund an agent wallet on the Tenderly chain: 0.1 native + 20_000 USDC.
 * First time: set exact balance. After cooldown: add to existing balance so we do not overwrite.
 * Uses chain config from env. Returns tx hashes or error.
 */
export async function fundSimulateWallet(
  walletAddress: string,
  ownerId: string,
  agentId: string,
  options?: { firstTime?: boolean }
): Promise<FundingResult> {
  const chain = getTenderlyChainConfig();
  if (!chain) {
    return { success: false, error: "Tenderly simulate chain is not configured." };
  }

  const normalizedAddress =
    walletAddress.startsWith("0x") ? walletAddress : `0x${walletAddress}`;
  const firstTime = options?.firstTime ?? true;

  try {
    const [nativeTxHash, usdcTxHash] =
      firstTime
        ? await Promise.all([
            setBalance(chain.adminRpcUrl, [normalizedAddress], ETH_FUND_AMOUNT_WEI),
            setErc20Balance(
              chain.adminRpcUrl,
              chain.usdcAddress,
              normalizedAddress,
              USDC_FUND_AMOUNT_UNITS
            ),
          ])
        : await Promise.all([
            addBalance(chain.adminRpcUrl, [normalizedAddress], ETH_FUND_AMOUNT_WEI),
            addErc20Balance(
              chain.adminRpcUrl,
              chain.usdcAddress,
              normalizedAddress,
              USDC_FUND_AMOUNT_UNITS
            ),
          ]);
    recordFundingRequest(ownerId, agentId);
    return {
      success: true,
      nativeTxHash: nativeTxHash || undefined,
      usdcTxHash: usdcTxHash || undefined,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
}

export { ETH_FUND_AMOUNT_WEI, USDC_FUND_AMOUNT_UNITS, REQUEST_COOLDOWN_MS };
