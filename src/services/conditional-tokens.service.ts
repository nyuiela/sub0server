/**
 * Conditional Tokens (CT) contract: getCollectionId and getPositionId for outcome position IDs.
 * Used when persisting a market so we store the CT position ID per outcome.
 */

import { createRequire } from "module";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { config } from "../config/index.js";

const require = createRequire(import.meta.url);
const contractsData = require("../lib/contracts.json") as {
  contracts?: { conditionalTokens?: string };
  conventions?: { parentCollectionId?: string };
};
const contracts = contractsData;

const CT_ADDRESS =
  (contracts.contracts?.conditionalTokens as Address) ??
  ("0xB01f9A7824fc1ffEF9c428AA8C0225b0e308a4F4" as Address);

const PARENT_COLLECTION_ID =
  (contracts.conventions?.parentCollectionId as Hex) ??
  ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hex);

const CT_ABI = [
  {
    type: "function" as const,
    name: "getCollectionId",
    inputs: [
      { name: "parentCollectionId", type: "bytes32", internalType: "bytes32" },
      { name: "conditionId", type: "bytes32", internalType: "bytes32" },
      { name: "indexSet", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view" as const,
  },
  {
    type: "function" as const,
    name: "getPositionId",
    inputs: [
      { name: "collateralToken", type: "address", internalType: "contract IERC20" },
      { name: "collectionId", type: "bytes32", internalType: "bytes32" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view" as const,
  },
] as const;

let publicClient: ReturnType<typeof createPublicClient> | null = null;

function getClient(): ReturnType<typeof createPublicClient> | null {
  const rpcUrl = config.chainRpcUrl?.trim();
  if (!rpcUrl) return null;
  if (publicClient === null) {
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    });
  }
  return publicClient;
}

/**
 * Get CT position ID for one outcome. indexSet = 1 << outcomeIndex (one slot set).
 */
async function getPositionIdForOutcome(
  conditionId: Hex,
  collateralToken: Address,
  outcomeIndex: number
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;
  const indexSet = BigInt(1 << outcomeIndex);
  try {
    const collectionId = await client.readContract({
      address: CT_ADDRESS,
      abi: CT_ABI,
      functionName: "getCollectionId",
      args: [PARENT_COLLECTION_ID, conditionId, indexSet],
    });
    const positionId = await client.readContract({
      address: CT_ADDRESS,
      abi: CT_ABI,
      functionName: "getPositionId",
      args: [collateralToken, collectionId],
    });
    return positionId.toString();
  } catch {
    return null;
  }
}

/**
 * Get position IDs for each outcome (0..outcomeSlotCount-1). Returns array of same length or null on error.
 */
export async function getOutcomePositionIds(
  conditionId: string,
  collateralToken: string,
  outcomeSlotCount: number
): Promise<string[] | null> {
  const client = getClient();
  if (!client || outcomeSlotCount <= 0) return null;
  const condHex = conditionId.startsWith("0x") ? (conditionId as Hex) : (`0x${conditionId}` as Hex);
  const tokenAddr = collateralToken.startsWith("0x")
    ? (collateralToken as Address)
    : (`0x${collateralToken}` as Address);
  const ids: string[] = [];
  for (let i = 0; i < outcomeSlotCount; i++) {
    const posId = await getPositionIdForOutcome(condHex, tokenAddr, i);
    if (posId == null) return null;
    ids.push(posId);
  }
  return ids;
}
