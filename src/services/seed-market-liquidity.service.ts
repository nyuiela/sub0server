/**
 * Seeds market liquidity on the PredictionVault contract (seedMarketLiquidity).
 * Used after a CRE-created market is persisted; signs tx with CONTRACT_PRIVATE_KEY.
 */

import { createRequire } from "module";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "../config/index.js";

const require = createRequire(import.meta.url);
const contractsData = require("../lib/contracts.json") as { contracts?: { predictionVault?: string } };

const PREDICTION_VAULT_ADDRESS =
  contractsData.contracts?.predictionVault;
import predictionVaultAbi from "../lib/contract/predictionVault.json" with { type: "json" };

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
  const vaultAddress = PREDICTION_VAULT_ADDRESS?.trim();
  const hasRpc = Boolean(config.chainRpcUrl?.trim());
  const hasPk = Boolean(config.contractPrivateKey?.trim());

  if (!hasRpc || !hasPk) {
    console.warn("[seed-market-liquidity] Skipped: missing CHAIN_RPC_URL or CONTRACT_PRIVATE_KEY");
    return false;
  }
  if (!vaultAddress) {
    console.warn("[seed-market-liquidity] Skipped: contracts.json has no predictionVault address");
    return false;
  }

  const clients = getClients();
  if (!clients) {
    console.warn("[seed-market-liquidity] Skipped: getClients() returned null");
    return false;
  }
  const account = clients.wallet.account;
  if (!account) {
    console.warn("[seed-market-liquidity] Skipped: wallet has no account");
    return false;
  }

  try {
    const hash = await clients.wallet.writeContract({
      account,
      address: vaultAddress as Hex,
      abi: predictionVaultAbi,
      functionName: "seedMarketLiquidity",
      args: [questionId, amountUsdc],
      chain: sepolia,
    });
    const receipt = await clients.public.waitForTransactionReceipt({ hash });
    const ok = receipt.status === "success";
    if (ok) {
      console.info("[seed-market-liquidity] Seeded", { questionId, hash, status: receipt.status });
    } else {
      console.warn("[seed-market-liquidity] Tx reverted", { questionId, hash, status: receipt.status });
    }
    return ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[seed-market-liquidity] Failed", { questionId, error: msg });
    return false;
  }
}
