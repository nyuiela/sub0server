/**
 * Agent balance sync: read USDC/collateral token balance from chain, compare with DB,
 * update DB if different, and broadcast agent update. Reusable by transfer and balance-update flows.
 */

import { Decimal } from "decimal.js";
import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import contractsData from "../lib/contracts.json" with { type: "json" };
import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { broadcastAgentUpdate } from "../lib/broadcast-agent.js";
import { upsertAgentChainBalance } from "../lib/agent-chain-balance.js";
import { CHAIN_KEY_MAIN } from "../types/agent-chain.js";

const contracts = contractsData as {
  contracts?: { usdc?: string };
  conventions?: { usdcDecimals?: number };
};

const ERC20_BALANCE_OF_ABI = [
  {
    type: "function" as const,
    name: "balanceOf",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view" as const,
  },
] as const;

const USDC_DECIMALS = contracts.conventions?.usdcDecimals ?? 6;

let publicClient: ReturnType<typeof createPublicClient> | null = null;

function getPublicClient(): ReturnType<typeof createPublicClient> | null {
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

function getCollateralTokenAddress(): Address {
  const fromConfig = config.defaultCollateralToken?.trim();
  if (fromConfig && fromConfig !== "0x0000000000000000000000000000000000000000") {
    return fromConfig as Address;
  }
  const fromContracts = contracts.contracts?.usdc;
  if (fromContracts) return fromContracts as Address;
  return "0x0ecdaB3BfcA91222b162A624D893bF49ec16ddBE" as Address;
}

/**
 * Format raw token amount (smallest units) to decimal string with up to 8 decimal places for DB.
 */
function rawBalanceToDecimalString(raw: bigint, decimals: number): string {
  const divisor = BigInt(10 ** decimals);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;
  if (fracPart === 0n) return intPart.toString();
  const fracStr = fracPart.toString().padStart(decimals, "0").slice(0, 8);
  const trimmed = fracStr.replace(/0+$/, "") || "0";
  return `${intPart}.${trimmed}`;
}

/**
 * Read ERC20 balance for wallet from chain. Returns decimal string or null if RPC/contract fails.
 */
export async function getAgentWalletBalanceOnChain(
  walletAddress: Address,
  tokenAddress?: Address
): Promise<string | null> {
  const client = getPublicClient();
  if (!client) return null;
  const token = tokenAddress ?? getCollateralTokenAddress();
  try {
    const raw = await client.readContract({
      address: token,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    });
    return rawBalanceToDecimalString(raw, USDC_DECIMALS);
  } catch {
    return null;
  }
}

export interface SyncAgentBalanceResult {
  updated: boolean;
  balance: string;
  previousBalance?: string;
  error?: string;
}

/**
 * Fetch agent USDC/collateral balance from chain; if different from DB, update DB and broadcast.
 * Use after transfers or any flow that changes on-chain balance. Returns current balance and whether DB was updated.
 */
export async function syncAgentBalance(agentId: string): Promise<SyncAgentBalanceResult> {
  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, walletAddress: true, balance: true },
  });
  if (!agent?.walletAddress?.trim()) {
    return {
      updated: false,
      balance: agent?.balance?.toString() ?? "0",
      error: "Agent has no wallet",
    };
  }

  const chainBalance = await getAgentWalletBalanceOnChain(agent.walletAddress as Address);
  if (chainBalance === null) {
    return {
      updated: false,
      balance: agent.balance.toString(),
      error: "Chain RPC or token read failed",
    };
  }

  const dbBalanceStr = agent.balance.toString();
  try {
    if (new Decimal(chainBalance).eq(new Decimal(dbBalanceStr))) {
      return { updated: false, balance: dbBalanceStr };
    }
  } catch {
    // fallback to string compare
    if (chainBalance === dbBalanceStr) return { updated: false, balance: dbBalanceStr };
  }

  await prisma.agent.update({
    where: { id: agentId },
    data: { balance: chainBalance },
  });
  await upsertAgentChainBalance(agentId, CHAIN_KEY_MAIN, chainBalance);

  await broadcastAgentUpdate({ agentId, balance: chainBalance });

  return {
    updated: true,
    balance: chainBalance,
    previousBalance: dbBalanceStr,
  };
}
