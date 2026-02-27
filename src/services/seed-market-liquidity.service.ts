/**
 * Seeds market liquidity on the PredictionVault contract (seedMarketLiquidity).
 * Used after a CRE-created market is persisted; signs tx with CONTRACT_PRIVATE_KEY.
 */

import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import contractsData from "../lib/contracts.json" with { type: "json" };
import { config } from "../config/index.js";

const PREDICTION_VAULT_ADDRESS =
  (contractsData as { contracts?: { predictionVault?: string } }).contracts?.predictionVault ??
  "0x37Ad1be17Be247854F9D4F8Af95eeEFFDe0b179E";

const SEED_MARKET_LIQUIDITY_ABI = [
  {
    type: "function" as const,
    name: "seedMarketLiquidity",
    inputs: [
      { name: "questionId", type: "bytes32", internalType: "bytes32" },
      { name: "amountUsdc", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable" as const,
  },
] as const;

let walletClient: ReturnType<typeof createWalletClient> | null = null;
let publicClient: ReturnType<typeof createPublicClient> | null = null;

function getClients(): {
  wallet: ReturnType<typeof createWalletClient>;
  public: ReturnType<typeof createPublicClient>;
} | null {
  const rpcUrl = config.chainRpcUrl;
  const pk = config.contractPrivateKey;
  if (!rpcUrl?.trim() || !pk) return null;
  if (publicClient === null) {
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    });
  }
  if (walletClient === null) {
    const account = privateKeyToAccount(pk);
    walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(rpcUrl),
    });
  }
  return { wallet: walletClient, public: publicClient };
}

/**
 * Calls predictionVault.seedMarketLiquidity(questionId, amountUsdc). Returns true if tx succeeded.
 */
export async function seedMarketLiquidityOnChain(
  questionId: Hex,
  amountUsdc: bigint
): Promise<boolean> {
  const clients = getClients();
  if (!clients) return false;
  try {
    const account = clients.wallet.account;
    if (!account) return false;
    const hash = await clients.wallet.writeContract({
      account,
      address: PREDICTION_VAULT_ADDRESS as Hex,
      abi: SEED_MARKET_LIQUIDITY_ABI,
      functionName: "seedMarketLiquidity",
      args: [questionId, amountUsdc],
      chain: sepolia,
    });
    const receipt = await clients.public.waitForTransactionReceipt({ hash });
    return receipt.status === "success";
  } catch {
    return false;
  }
}
