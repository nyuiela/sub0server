/**
 * Agent onboarding: fund agent wallet with ETH, then agent signs USDC approve and CT setApprovalForAll.
 * Uses CONTRACT_PRIVATE_KEY as funder; agentPrivateKeyHex for the two approvals.
 */

import { createRequire } from "module";
import type { FastifyBaseLogger } from "fastify";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "../config/index.js";

const require = createRequire(import.meta.url);
const contractsData = require("../lib/contracts.json") as {
  contracts?: { usdc?: string; conditionalTokens?: string; predictionVault?: string };
};
const contracts = contractsData;
const USDC_ADDRESS = contracts.contracts?.usdc ?? "0x0ecdaB3BfcA91222b162A624D893bF49ec16ddBE";
const CT_ADDRESS =
  contracts.contracts?.conditionalTokens ?? "0xB01f9A7824fc1ffEF9c428AA8C0225b0e308a4F4";
const PREDICTION_VAULT_ADDRESS =
  contracts.contracts?.predictionVault ?? "0x37Ad1be17Be247854F9D4F8Af95eeEFFDe0b179E";

const MAX_U256 = 2n ** 256n - 1n;

const ERC20_APPROVE_ABI = [
  {
    type: "function" as const,
    name: "approve",
    inputs: [
      { name: "spender", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable" as const,
  },
] as const;

const ERC1155_SET_APPROVAL_FOR_ALL_ABI = [
  {
    type: "function" as const,
    name: "setApprovalForAll",
    inputs: [
      { name: "operator", type: "address", internalType: "address" },
      { name: "approved", type: "bool", internalType: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable" as const,
  },
] as const;

let publicClient: ReturnType<typeof createPublicClient> | null = null;

function getPublicClient(): ReturnType<typeof createPublicClient> | null {
  const rpcUrl = config.chainRpcUrl;
  if (!rpcUrl?.trim()) return null;
  if (publicClient === null) {
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    });
  }
  return publicClient;
}

function normalizePrivateKey(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

export interface AgentOnboardingResult {
  ethTransfer?: { hash: Hex } | { error: string };
  erc20Approve?: { hash: Hex } | { error: string };
  ctSetApprovalForAll?: { hash: Hex } | { error: string };
}

/**
 * 1. Funder (CONTRACT_PRIVATE_KEY) sends ETH to agentAddress.
 * 2. Agent (agentPrivateKeyHex) calls USDC.approve(predictionVault, max).
 * 3. Agent calls conditionalTokens.setApprovalForAll(predictionVault, true).
 */
export async function executeAgentOnboarding(
  agentPrivateKeyHex: string,
  agentAddress: string,
  log?: FastifyBaseLogger
): Promise<AgentOnboardingResult> {
  const rpcUrl = config.chainRpcUrl;
  const funderPk = config.contractPrivateKey;
  if (!rpcUrl?.trim()) {
    log?.warn("agentOnboarding: Chain RPC not configured");
    return {};
  }
  const client = getPublicClient();
  if (!client) return {};

  const result: AgentOnboardingResult = {};

  const agentPk = normalizePrivateKey(agentPrivateKeyHex);
  const agentAccount = privateKeyToAccount(agentPk);
  const agentWallet = createWalletClient({
    account: agentAccount,
    chain: sepolia,
    transport: http(rpcUrl),
  });

  if (funderPk && config.agentOnboardingEthWei > 0n) {
    const funderAccount = privateKeyToAccount(funderPk);
    const funderWallet = createWalletClient({
      account: funderAccount,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    log?.info(
      { to: agentAddress, wei: config.agentOnboardingEthWei.toString() },
      "agentOnboarding: sending ETH to agent"
    );
    try {
      const hash = await funderWallet.sendTransaction({
        to: agentAddress as Hex,
        value: config.agentOnboardingEthWei,
      });
      log?.info({ hash }, "agentOnboarding: ETH tx sent, waiting for receipt");
      await client.waitForTransactionReceipt({ hash });
      result.ethTransfer = { hash };
      log?.info({ hash }, "agentOnboarding: ETH tx confirmed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ error: msg }, "agentOnboarding: ETH transfer failed");
      result.ethTransfer = { error: msg };
    }
  }

  log?.info("agentOnboarding: USDC approve");
  try {
    const hash = await agentWallet.writeContract({
      address: USDC_ADDRESS as Hex,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [PREDICTION_VAULT_ADDRESS as Hex, MAX_U256],
    });
    await client.waitForTransactionReceipt({ hash });
    result.erc20Approve = { hash };
    log?.info({ hash }, "agentOnboarding: USDC approve confirmed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ error: msg }, "agentOnboarding: USDC approve failed");
    result.erc20Approve = { error: msg };
  }

  log?.info("agentOnboarding: CT setApprovalForAll");
  try {
    const hash = await agentWallet.writeContract({
      address: CT_ADDRESS as Hex,
      abi: ERC1155_SET_APPROVAL_FOR_ALL_ABI,
      functionName: "setApprovalForAll",
      args: [PREDICTION_VAULT_ADDRESS as Hex, true],
    });
    await client.waitForTransactionReceipt({ hash });
    result.ctSetApprovalForAll = { hash };
    log?.info({ hash }, "agentOnboarding: CT setApprovalForAll confirmed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ error: msg }, "agentOnboarding: CT setApprovalForAll failed");
    result.ctSetApprovalForAll = { error: msg };
  }

  return result;
}
