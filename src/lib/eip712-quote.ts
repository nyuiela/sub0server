/**
 * EIP-712 typed data for LMSR quote. Backend signs; PredictionVault verifies on-chain.
 * Struct must match Solidity: marketId (bytes32), outcomeIndex (uint256), buy (bool),
 * quantity (uint256), tradeCostUsdc (uint256), nonce (uint256), deadline (uint256).
 */

import type { PrivateKeyAccount } from "viem/accounts";
import { type Hex, type Address, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import type { LMSRQuote } from "../types/lmsr.js";

export const QUOTE_DOMAIN_NAME = "Sub0PredictionVault";
export const QUOTE_DOMAIN_VERSION = "1";
export const QUOTE_PRIMARY_TYPE = "LMSRQuote" as const;

export interface QuoteTypedData {
  marketId: Hex;
  outcomeIndex: bigint;
  buy: boolean;
  quantity: bigint;
  tradeCostUsdc: bigint;
  nonce: bigint;
  deadline: bigint;
}

/** USDC 6 decimals. */
export const USDC_DECIMALS = 6;
/** Outcome shares 18 decimals. */
export const SHARES_DECIMALS = 18;

function toSharesBigInt(quantity: string): bigint {
  const [whole, frac = ""] = quantity.split(".");
  const padded = frac.padEnd(SHARES_DECIMALS, "0").slice(0, SHARES_DECIMALS);
  return BigInt(whole + padded);
}

function toUsdcBigInt(amount: string): bigint {
  const [whole, frac = ""] = amount.split(".");
  const padded = frac.padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  return BigInt(whole + padded);
}

export function quoteToTypedData(quote: LMSRQuote): QuoteTypedData {
  const marketIdBytes32 = keccak256(encodeAbiParameters(parseAbiParameters("string"), [quote.marketId]));
  const tradeCostAbs = quote.tradeCost.startsWith("-") ? quote.tradeCost.slice(1) : quote.tradeCost;
  return {
    marketId: marketIdBytes32,
    outcomeIndex: BigInt(quote.outcomeIndex),
    buy: quote.side === "BUY",
    quantity: toSharesBigInt(quote.quantity),
    tradeCostUsdc: toUsdcBigInt(tradeCostAbs),
    nonce: BigInt(quote.nonce),
    deadline: BigInt(quote.deadline),
  };
}

export interface QuoteDomain {
  name: typeof QUOTE_DOMAIN_NAME;
  version: typeof QUOTE_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Address;
}

const quoteTypes = {
  LMSRQuote: [
    { name: "marketId", type: "bytes32" },
    { name: "outcomeIndex", type: "uint256" },
    { name: "buy", type: "bool" },
    { name: "quantity", type: "uint256" },
    { name: "tradeCostUsdc", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ] as const,
};

export async function signQuote(
  quote: LMSRQuote,
  domain: QuoteDomain,
  account: PrivateKeyAccount
): Promise<Hex> {
  const message = quoteToTypedData(quote);
  return account.signTypedData({
    domain: {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
    },
    types: { LMSRQuote: quoteTypes.LMSRQuote },
    primaryType: QUOTE_PRIMARY_TYPE,
    message,
  });
}

export { quoteTypes };
