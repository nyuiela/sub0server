/**
 * EIP-712 UserTrade typed data for order signing.
 * Contract: USER_TRADE_TYPEHASH = keccak256(
 *   "UserTrade(bytes32 marketId,uint256 outcomeIndex,bool buy,uint256 quantity,uint256 maxCostUsdc,uint256 nonce,uint256 deadline)"
 * )
 */

import contractsData from "./contracts.json" with { type: "json" };
// const contractsData = require("./contracts.json");

type ContractsJson = {
  chainId?: number;
  contracts?: { predictionVault?: string };
  eip712?: { domainName?: string; domainVersion?: string };
};

const CONTRACTS = contractsData as ContractsJson;
const CHAIN_ID = CONTRACTS.chainId ?? 11155111;
const VERIFYING_CONTRACT = CONTRACTS.contracts?.predictionVault as `0x${string}` | undefined;
const DOMAIN_NAME = CONTRACTS.eip712?.domainName ?? "Sub0PredictionVault";
const DOMAIN_VERSION = CONTRACTS.eip712?.domainVersion ?? "1";

/** Hex string to bytes32 (0x + 64 hex chars). Left-pads with zeros if shorter. */
export function hexToBytes32(hex: string): `0x${string}` {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  const normalized = raw.toLowerCase().replace(/[^0-9a-f]/g, "");
  const padded = normalized.length <= 64 ? normalized.padStart(64, "0") : normalized.slice(-64);
  return (`0x${padded}`) as `0x${string}`;
}

export interface UserTradeMessage {
  marketId: `0x${string}`;
  outcomeIndex: bigint;
  buy: boolean;
  quantity: string | number | bigint;
  maxCostUsdc: string | number | bigint;
  nonce: bigint;
  deadline: bigint;
}

export interface UserTradeTypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  types: {
    UserTrade: Array<{ name: string; type: string }>;
  };
  primaryType: "UserTrade";
  message: UserTradeMessage;
}

// /** Build EIP-712 typed data for UserTrade. Uses questionId (bytes32 hex) for the contract's questionId; type field name remains "marketId" per contract. */
// export function buildUserTradeTypedData(params: {
//   questionId: string;
//   outcomeIndex: number;
//   buy: boolean;
//   quantity: string | number | bigint;
//   maxCostUsdc: string | number | bigint;
//   nonce: string | number | bigint;
//   deadline: number;
// }): UserTradeTypedData {
//   const nonceBig = typeof params.nonce === "bigint" ? params.nonce : BigInt(String(params.nonce));
//   const questionIdBytes32 = hexToBytes32(params.questionId);
//   return {
//     domain: {
//       name: DOMAIN_NAME,
//       version: DOMAIN_VERSION,
//       chainId: CHAIN_ID,
//       verifyingContract: VERIFYING_CONTRACT ?? ("0x0000000000000000000000000000000000000000" as `0x${string}`),
//     },
//     types: {
//       UserTrade: [
//         { name: "marketId", type: "bytes32" },
//         { name: "outcomeIndex", type: "uint256" },
//         { name: "buy", type: "bool" },
//         { name: "quantity", type: "uint256" },
//         { name: "maxCostUsdc", type: "uint256" },
//         { name: "nonce", type: "uint256" },
//         { name: "deadline", type: "uint256" },
//       ],
//     },
//     primaryType: "UserTrade",
//     message: {
//       marketId: questionIdBytes32,
//       outcomeIndex: BigInt(params.outcomeIndex),
//       buy: params.buy,
//       quantity: params.quantity,
//       maxCostUsdc: params.maxCostUsdc,
//       nonce: nonceBig,
//       deadline: BigInt(params.deadline),
//     },
//   };
// }

// /** Serialize typed data for eth_signTypedData_v4 (message values as hex/decimal strings). */
export function serializeTypedDataForSigning(data: UserTradeTypedData): Record<string, unknown> {
  const msg = data.message;
  return {
    domain: data.domain,
    types: data.types,
    primaryType: data.primaryType,
    message: {
      marketId: msg.marketId,
      outcomeIndex: msg.outcomeIndex.toString(),
      buy: msg.buy,
      quantity: msg.quantity.toString(),
      maxCostUsdc: msg.maxCostUsdc.toString(),
      nonce: msg.nonce.toString(),
      deadline: msg.deadline.toString(),
    },
  };
}

/** EIP-1193 provider type for signing. */
export type EIP1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

/**
 * Request EIP-712 signature from the given provider (e.g. window.ethereum).
 * Returns 0x-prefixed signature string.
 */
// export async function signUserTradeTypedData(
//   provider: EIP1193Provider,
//   address: string,
//   typedData: Record<string, unknown>
// ): Promise<string> {
//   const result = await provider.request({
//     method: "eth_signTypedData_v4",
//     params: [address, JSON.stringify(typedData)],
//   });
//   return typeof result === "string" ? result : "";
// }
import { createWalletClient, custom } from 'viem';
import { sepolia } from 'viem/chains';

// 1. Update the builder to include the EIP712Domain type explicitly
export function buildUserTradeTypedData(params: {
  questionId: string;
  outcomeIndex: number;
  buy: boolean;
  quantity: string | number | bigint;
  maxCostUsdc: string | number | bigint;
  nonce: string | number | bigint;
  deadline: number;
}) {
  const nonceBig = typeof params.nonce === "bigint" ? params.nonce : BigInt(String(params.nonce));
  const questionIdBytes32 = hexToBytes32(params.questionId);

  return {
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT ?? ("0x0000000000000000000000000000000000000000" as `0x${string}`),
    },
    types: {
      UserTrade: [
        { name: "marketId", type: "bytes32" },
        { name: "outcomeIndex", type: "uint256" },
        { name: "buy", type: "bool" },
        { name: "quantity", type: "uint256" },
        { name: "maxCostUsdc", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "UserTrade" as const,
    message: {
      marketId: questionIdBytes32,
      outcomeIndex: BigInt(params.outcomeIndex),
      buy: params.buy,
      quantity: BigInt(params.quantity),
      maxCostUsdc: BigInt(params.maxCostUsdc),
      nonce: nonceBig,
      deadline: BigInt(params.deadline),
    },
  };
}

// 2. Rewrite the signing function to use Viem instead of raw RPC
export async function signUserTradeTypedData(
  provider: EIP1193Provider,
  address: string,
  typedData: Record<string, unknown>
): Promise<string> {
  try {
    // Check if this is a Viem wallet client (from ThirdWeb)
    if (provider && 'signTypedData' in provider && typeof (provider as any).signTypedData === 'function') {
      // Use Viem's signTypedData method
      const result = await (provider as any).signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });
      return result;
    }

    // Fallback to raw RPC method for MetaMask and other wallets
    const result = await provider.request({
      method: "eth_signTypedData_v4",
      params: [address, JSON.stringify(typedData)],
    });

    let signature = typeof result === "string" ? result : "";

    if (!signature.startsWith("0x")) {
      signature = "0x" + signature;
    }

    return signature;
  } catch (error) {
    console.error("Signing error:", error);
    throw error;
  }
}

/** Default deadline: 5 minutes from now (unix seconds). */
export function defaultDeadline(): number {
  return Math.floor(Date.now() / 1000) + 300;
}

/** Typed data shape expected by viem recoverTypedDataAddress (EIP-712 domain). */
type RecoverDomain = {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: `0x${string}`;
};

/**
 * Recover the signer address from an EIP-712 UserTrade signature (for debugging).
 * Uses the same typed data that was signed (serialized form with string message values).
 * Returns the recovered address or null on failure.
 */
export async function recoverUserTradeSigner(
  serializedTypedData: Record<string, unknown>,
  signature: string
): Promise<string | null> {
  try {
    // #region agent log
    /*
    if (typeof fetch !== "undefined") {
      fetch("http://127.0.0.1:7916/ingest/6bd2cfb3-987f-41c0-b780-8a7f894a6c2e", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "44a402" },
        body: JSON.stringify({
          sessionId: "44a402",
          runId: "signature-debug",
          hypothesisId: "H3-H5",
          location: "userTradeSignature.ts:recoverUserTradeSigner",
          message: "viem recovery input",
          data: {
            domain: serializedTypedData.domain,
            message: serializedTypedData.message,
            primaryType: serializedTypedData.primaryType,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => { });
    }
    */
    // #endregion
    const { recoverTypedDataAddress } = await import("viem/utils");
    const recovered = await recoverTypedDataAddress({
      domain: serializedTypedData.domain as RecoverDomain,
      types: serializedTypedData.types as { UserTrade: Array<{ name: string; type: string }> },
      primaryType: (serializedTypedData.primaryType as "UserTrade") ?? "UserTrade",
      message: serializedTypedData.message as Record<string, unknown>,
      signature: signature as `0x${string}`,
    });
    return recovered ?? null;
  } catch (e) {
    console.error("recoverUserTradeSigner failed:", e);
    return null;
  }
}
