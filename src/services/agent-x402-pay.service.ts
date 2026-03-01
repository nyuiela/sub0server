/**
 * Agent-paid x402: pay simulation fee from the agent's wallet on the x402 chain (Base Sepolia / Base).
 * Used when starting a simulation so the user does not pay; the agent signs with its private key.
 */

import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getPrismaClient } from "../lib/prisma.js";
import { decryptPrivateKey } from "./agent-keys.service.js";
import { getX402Config } from "../x402/config.js";

const ERC20_TRANSFER_ABI = [
  {
    type: "function" as const,
    name: "transfer",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable" as const,
  },
  {
    type: "function" as const,
    name: "balanceOf",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view" as const,
  },
] as const;

function chainForId(chainId: number): typeof baseSepolia | typeof base {
  return chainId === 8453 ? base : baseSepolia;
}

function normalizePrivateKey(raw: string): Hex {
  const trimmed = raw.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as Hex;
}

export interface AgentPayResult {
  ok: true;
  txHash: string;
}

export interface AgentPayError {
  ok: false;
  error: string;
  code?: "NO_WALLET" | "NO_KEY" | "INSUFFICIENT_BALANCE" | "TRANSFER_FAILED" | "CONFIG";
}

/**
 * Pay the simulation fee (USDC) from the agent's wallet to the x402 receiver.
 * Reads agent's encrypted key, checks balance on x402 chain, sends transfer, waits for receipt.
 */
export async function paySimulateWithAgent(
  agentId: string,
  amountAtomic: string
): Promise<AgentPayResult | AgentPayError> {
  const x402 = getX402Config();
  if (!x402.enabled || !x402.receiverAddress?.trim() || !x402.rpcUrl?.trim()) {
    return { ok: false, error: "Payment chain not configured", code: "CONFIG" };
  }

  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { walletAddress: true, encryptedPrivateKey: true },
  });
  if (!agent?.walletAddress?.trim()) {
    return { ok: false, error: "Agent has no wallet. Create a wallet for this agent first.", code: "NO_WALLET" };
  }
  if (!agent.encryptedPrivateKey?.trim()) {
    return { ok: false, error: "Agent wallet key not available. Cannot pay from agent.", code: "NO_KEY" };
  }

  let privateKeyHex: string;
  try {
    privateKeyHex = decryptPrivateKey(agent.encryptedPrivateKey);
  } catch {
    return { ok: false, error: "Agent key decryption failed.", code: "NO_KEY" };
  }

  const chain = chainForId(x402.chainId);
  const transport = http(x402.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(normalizePrivateKey(privateKeyHex));
  const walletClient = createWalletClient({
    account,
    chain,
    transport,
  });

  const usdcAddress = x402.usdcAddress as Address;
  const receiver = x402.receiverAddress as Address;
  const amount = BigInt(amountAtomic);

  const balance = await publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_TRANSFER_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (balance < amount) {
    const need = Number(amount) / 1e6;
    return {
      ok: false,
      error: `Insufficient USDC on payment chain. The agent needs at least ${need.toFixed(2)} USDC. Fund the agent wallet to run simulations.`,
      code: "INSUFFICIENT_BALANCE",
    };
  }

  try {
    const hash = await walletClient.writeContract({
      address: usdcAddress,
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [receiver, amount],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { ok: false, error: "Payment transaction failed.", code: "TRANSFER_FAILED" };
    }
    return { ok: true, txHash: hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Transfer failed";
    return { ok: false, error: `Payment failed: ${msg}`, code: "TRANSFER_FAILED" };
  }
}
