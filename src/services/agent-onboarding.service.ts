/**
 * Agent onboarding: fund agent wallet with ETH (Sepolia + optional Base Sepolia), then agent signs
 * on Sepolia: USDC.approve(predictionVault, max uint256) and conditionalTokens.setApprovalForAll(predictionVault, true).
 * Uses CONTRACT_PRIVATE_KEY as funder; agentPrivateKeyHex for the approvals.
 */

import { createRequire } from "module";
import type { FastifyBaseLogger } from "fastify";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, sepolia } from "viem/chains";
import { config } from "../config/index.js";

const require = createRequire(import.meta.url);
const contractsData = require("../lib/contracts.json") as {
  chainId: number;
  chainRpcUrl: string;
  baseSepoliaRpcUrl: string;
  contracts?: { usdc?: string; conditionalTokens?: string; predictionVault?: string };
  platform?: { creatorAddress?: string; oracleAddress?: string; usdcAddress?: string; initialLiquidityPerOutcome?: string };
  eip712?: { domainName?: string; domainVersion?: string; quoteTypeName?: string };
  conventions?: { usdcDecimals?: number; outcomeTokenDecimals?: number; parentCollectionId?: string };
};
const contracts = contractsData;
const USDC_ADDRESS = contracts.contracts?.usdc;
const BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const CT_ADDRESS = contracts.contracts?.conditionalTokens;
const PREDICTION_VAULT_ADDRESS = contracts.contracts?.predictionVault;

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

const BASE_ERC20 = [
  {
    type: "function" as const,
    name: "transfer",
    inputs: [
      { name: "to", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "nonpayable" as const,
  }
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
let baseSepoliaPublicClient: ReturnType<typeof createPublicClient> | null = null;

export function getPublicClient(): ReturnType<typeof createPublicClient> | null {
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

function getBaseSepoliaPublicClient(): ReturnType<typeof createPublicClient> | null {
  const baseSepoliaRpcUrl = contracts.baseSepoliaRpcUrl;
  if (!baseSepoliaRpcUrl?.trim()) return null;
  if (baseSepoliaPublicClient === null) {
    baseSepoliaPublicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(baseSepoliaRpcUrl),
    }) as ReturnType<typeof createPublicClient>;
  }
  return baseSepoliaPublicClient;
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
 * 1. Funder (CONTRACT_PRIVATE_KEY) sends ETH to agent (Sepolia, optional Base Sepolia + USDC).
 * 2. Agent on Sepolia: USDC.approve(predictionVault, type(uint256).max).
 * 3. Agent on Sepolia: conditionalTokens.setApprovalForAll(predictionVault, true).
 */
export async function executeAgentOnboarding(
    agentPrivateKeyHex: string,
    agentAddress: string,
    log?: FastifyBaseLogger
  ): Promise<AgentOnboardingResult> {
    const rpcUrl = config.chainRpcUrl;
    const baseSepoliaRpcUrl = contracts.baseSepoliaRpcUrl;
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
    const agentWalletBase = createWalletClient({
      account: agentAccount,
      chain: baseSepolia,
      transport: http(baseSepoliaRpcUrl),
    });

    if (funderPk) {
      const funderAccount = privateKeyToAccount(funderPk);
      const funderWallet = createWalletClient({
        account: funderAccount,
        chain: sepolia,
        transport: http(rpcUrl),
      });
      const funderWalletBase = createWalletClient({
        account: funderAccount,
        chain: baseSepolia,
        transport: http(baseSepoliaRpcUrl),
      });

      try {
        if (config.agentOnboardingEthWei > 0n) {
          const hashSepolia = await funderWallet.sendTransaction({
            to: agentAddress as Hex,
            value: config.agentOnboardingEthWei,
          });
          await client.waitForTransactionReceipt({ hash: hashSepolia });
          result.ethTransfer = { hash: hashSepolia };
          log?.info({ hashSepolia }, "agentOnboarding: Sepolia ETH sent to agent");
        }

        if (config.agentOnboardingEthWeiBaseSepolia > 0n) {
          const hashBaseEth = await funderWalletBase.sendTransaction({
            to: agentAddress as Hex,
            value: config.agentOnboardingEthWeiBaseSepolia,
          });
          const baseClient = getBaseSepoliaPublicClient();
          if (baseClient) {
            await baseClient.waitForTransactionReceipt({ hash: hashBaseEth });
          }
          log?.info({ hashBaseEth }, "agentOnboarding: Base Sepolia ETH sent to agent");
        }

        if (config.agentOnboardingUsdcAmount > 0n) {
          const hashBaseUsdc = await funderWalletBase.writeContract({
            address: BASE_USDC_ADDRESS as Hex,
            abi: BASE_ERC20,
            functionName: "transfer",
            args: [agentAddress as Hex, config.agentOnboardingUsdcAmount],
          });
          const baseClient = getBaseSepoliaPublicClient();
          if (baseClient) {
            await baseClient.waitForTransactionReceipt({ hash: hashBaseUsdc });
          }
          log?.info({ hashBaseUsdc }, "agentOnboarding: Base Sepolia USDC sent to agent");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("insufficient funds")) {
          log?.warn(
            "agentOnboarding: funding failed (funder may lack Base Sepolia ETH). Fund CONTRACT_PRIVATE_KEY wallet on Base Sepolia with at least AGENT_ONBOARDING_ETH_WEI_BASE_SEPOLIA + gas."
          );
        }
        log?.warn({ error: msg }, "agentOnboarding: funding failed");
        result.ethTransfer = { error: msg };
        return result;
      }
    }

    log?.info("agentOnboarding: Sepolia USDC approve (max uint256)");
    try {
      if (USDC_ADDRESS && PREDICTION_VAULT_ADDRESS) {
        const hash = await agentWallet.writeContract({
          address: USDC_ADDRESS as Hex,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [PREDICTION_VAULT_ADDRESS as Hex, MAX_U256],
        });
        await client.waitForTransactionReceipt({ hash });
        result.erc20Approve = { hash };
        log?.info({ hash }, "agentOnboarding: Sepolia USDC approve confirmed");
      } else {
        log?.warn("agentOnboarding: USDC or predictionVault address missing; skipping approve");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ error: msg }, "agentOnboarding: USDC approve failed");
      result.erc20Approve = { error: msg };
    }

    log?.info("agentOnboarding: Sepolia CT setApprovalForAll (allow predictionVault)");
    try {
      if (CT_ADDRESS && PREDICTION_VAULT_ADDRESS) {
        const hash = await agentWallet.writeContract({
          address: CT_ADDRESS as Hex,
          abi: ERC1155_SET_APPROVAL_FOR_ALL_ABI,
          functionName: "setApprovalForAll",
          args: [PREDICTION_VAULT_ADDRESS as Hex, true],
        });
        await client.waitForTransactionReceipt({ hash });
        result.ctSetApprovalForAll = { hash };
        log?.info({ hash }, "agentOnboarding: Sepolia CT setApprovalForAll confirmed");
      } else {
        log?.warn("agentOnboarding: conditionalTokens or predictionVault address missing; skipping setApprovalForAll");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.warn({ error: msg }, "agentOnboarding: CT setApprovalForAll failed");
      result.ctSetApprovalForAll = { error: msg };
    }

    return result;
  }