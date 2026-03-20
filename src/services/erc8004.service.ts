/**
 * ERC-8004 Trustless Agents integration service.
 *
 * Publishes Sub0 agent identity, reputation, and TEE proofs to the public
 * ERC-8004 registries deployed on Sepolia so agents are discoverable and
 * verifiable across the broader on-chain agent economy.
 *
 * Registries (Sepolia):
 *   IdentityRegistry:    0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   ReputationRegistry:  0x8004B663056A597Dffe9eCcC1965A193B7388713
 *   ValidationRegistry:  fetched from the ERC-8004 repo (add to config when available)
 *
 * All on-chain calls require BACKEND_SIGNER_PRIVATE_KEY with sufficient ETH.
 * Each function fails gracefully — a failed publish never blocks core trading.
 */

import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { getPrismaClient } from "../lib/prisma.js";
import { config } from "../config/index.js";

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const;

const identityRegistryAbi = parseAbi([
  "function mint(address to, string calldata metadataURI) external returns (uint256 tokenId)",
  "function tokenOfOwner(address owner) external view returns (uint256)",
]);

const reputationRegistryAbi = parseAbi([
  "function updateReputation(address agent, int256 pnlBps, uint256 winRateBps) external",
]);

const validationRegistryAbi = parseAbi([
  "function publishProof(address agent, bytes32 proofHash, uint8 proofType) external",
]);

function getSignerAccount() {
  const raw = config.contractPrivateKey?.trim() ?? "";
  if (!raw) return null;
  try {
    return privateKeyToAccount(raw as `0x${string}`);
  } catch {
    return null;
  }
}

function buildClients() {
  const account = getSignerAccount();
  if (!account) return null;
  const rpcUrl = config.chainRpcUrl ?? "https://rpc.sepolia.org";
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });
  return { publicClient, walletClient, account };
}

/**
 * Mint an ERC-8004 IdentityRegistry NFT for a newly created agent.
 * Stores the resulting tokenId back in the Agent row.
 */
export async function registerAgentIdentity(agentId: string, agentWalletAddress: string): Promise<string | null> {
  const clients = buildClients();
  if (!clients) {
    console.warn("[erc8004] BACKEND_SIGNER_PRIVATE_KEY not set; skipping identity mint");
    return null;
  }
  try {
    const metadataURI = `https://sub0.app/api/agents/${agentId}/metadata`;
    const { walletClient, publicClient, account } = clients;
    const hash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY,
      abi: identityRegistryAbi,
      functionName: "mint",
      args: [agentWalletAddress as `0x${string}`, metadataURI],
      account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    // Parse tokenId from Transfer event log (ERC-721 Transfer emits tokenId as topic[3])
    const tokenId = receipt.logs[0]?.topics?.[3] ?? null;
    const tokenIdStr = tokenId ? BigInt(tokenId).toString() : null;

    if (tokenIdStr) {
      const prisma = getPrismaClient();
      await prisma.agent.update({ where: { id: agentId }, data: { erc8004TokenId: tokenIdStr } });
    }
    console.info(`[erc8004] identity minted agentId=${agentId} tokenId=${tokenIdStr ?? "unknown"}`);
    return tokenIdStr;
  } catch (err) {
    console.warn(`[erc8004] identity mint failed agentId=${agentId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Update the agent's reputation entry (PnL bps, win-rate bps) on ERC-8004 ReputationRegistry.
 * Called daily from a cron or after each trade settlement.
 */
export async function updateAgentReputation(
  agentId: string,
  pnl: number,
  winRate: number
): Promise<boolean> {
  const clients = buildClients();
  if (!clients) return false;

  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { walletAddress: true },
  });
  if (!agent?.walletAddress) return false;

  try {
    const { walletClient, account } = clients;
    // pnlBps: pnl * 100 (basis points), winRateBps: winRate * 10000 (0-100% as bps)
    const pnlBps = BigInt(Math.round(pnl * 100));
    const winRateBps = BigInt(Math.round(winRate * 10000));
    await walletClient.writeContract({
      address: REPUTATION_REGISTRY,
      abi: reputationRegistryAbi,
      functionName: "updateReputation",
      args: [agent.walletAddress as `0x${string}`, pnlBps, winRateBps],
      account,
    });
    console.info(`[erc8004] reputation updated agentId=${agentId} pnlBps=${pnlBps} winRateBps=${winRateBps}`);
    return true;
  } catch (err) {
    console.warn(`[erc8004] reputation update failed agentId=${agentId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Publish a TEE proof hash to the ERC-8004 ValidationRegistry.
 * proofType: 0 = evolution, 1 = debate, 2 = compliance
 */
export async function publishValidationProof(
  agentId: string,
  proofHash: string,
  proofType: 0 | 1 | 2,
  validationRegistryAddress?: string
): Promise<boolean> {
  const registryAddr = validationRegistryAddress ?? process.env.ERC8004_VALIDATION_REGISTRY?.trim();
  if (!registryAddr) {
    console.info(`[erc8004] ValidationRegistry address not configured; skipping proof publish for agentId=${agentId}`);
    return false;
  }

  const clients = buildClients();
  if (!clients) return false;

  const prisma = getPrismaClient();
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { walletAddress: true },
  });
  if (!agent?.walletAddress) return false;

  try {
    const { walletClient, account } = clients;
    const hashBytes = proofHash.startsWith("0x") ? proofHash : `0x${proofHash}`;
    await walletClient.writeContract({
      address: registryAddr as `0x${string}`,
      abi: validationRegistryAbi,
      functionName: "publishProof",
      args: [agent.walletAddress as `0x${string}`, hashBytes as `0x${string}`, proofType],
      account,
    });
    console.info(`[erc8004] proof published agentId=${agentId} type=${proofType} hash=${proofHash}`);
    return true;
  } catch (err) {
    console.warn(`[erc8004] proof publish failed agentId=${agentId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
