/**
 * Sign LMSR quote (EIP-712) with agent's private key for SDK/BYOA.
 * Matches CRE PredictionVault LMSRQuote structure.
 */

import { signTypedData } from "viem/accounts";
import type { Address, Hex } from "viem";
import { config } from "../config/index.js";
import { decryptPrivateKey } from "./agent-keys.service.js";

export interface LMSRQuoteParams {
  questionId: `0x${string}`;
  outcomeIndex: number;
  buy: boolean;
  quantity: string;
  tradeCostUsdc: string;
  nonce: string;
  deadline: string;
}

export interface SignedQuoteResult {
  questionId: string;
  outcomeIndex: number;
  buy: boolean;
  quantity: string;
  tradeCostUsdc: string;
  nonce: string;
  deadline: string;
  signature: `0x${string}`;
}

export function isQuoteSigningConfigured(): boolean {
  const chainId = config.sdkQuoteChainId;
  const vault = config.predictionVaultAddress;
  return typeof chainId === "number" && !!vault?.trim();
}

export async function signLMSRQuoteForAgent(
  encryptedPrivateKey: string,
  params: LMSRQuoteParams
): Promise<SignedQuoteResult> {
  const chainId = config.sdkQuoteChainId;
  const verifyingContract = config.predictionVaultAddress;
  if (chainId == null || !verifyingContract?.trim()) {
    throw new Error("SDK quote signing not configured (SDK_QUOTE_CHAIN_ID, PREDICTION_VAULT_ADDRESS)");
  }
  const privateKeyHex = decryptPrivateKey(encryptedPrivateKey);
  const key = privateKeyHex.startsWith("0x") ? (privateKeyHex as Hex) : (`0x${privateKeyHex}` as Hex);

  const domain = {
    name: config.eip712DomainName,
    version: config.eip712DomainVersion,
    chainId,
    verifyingContract: verifyingContract as Address,
  };
  const types = {
    LMSRQuote: [
      { name: "questionId", type: "bytes32" },
      { name: "outcomeIndex", type: "uint256" },
      { name: "buy", type: "bool" },
      { name: "quantity", type: "uint256" },
      { name: "tradeCostUsdc", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const message = {
    questionId: params.questionId as `0x${string}`,
    outcomeIndex: BigInt(params.outcomeIndex),
    buy: params.buy,
    quantity: BigInt(params.quantity),
    tradeCostUsdc: BigInt(params.tradeCostUsdc),
    nonce: BigInt(params.nonce),
    deadline: BigInt(params.deadline),
  };

  const signature = await signTypedData({
    privateKey: key,
    domain,
    types,
    primaryType: "LMSRQuote",
    message,
  });

  return {
    questionId: params.questionId,
    outcomeIndex: params.outcomeIndex,
    buy: params.buy,
    quantity: params.quantity,
    tradeCostUsdc: params.tradeCostUsdc,
    nonce: params.nonce,
    deadline: params.deadline,
    signature,
  };
}
