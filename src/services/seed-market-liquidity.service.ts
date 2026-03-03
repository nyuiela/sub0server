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
import predictionVaultAbi from "../lib/contract/predictionVault.json" assert { type: "json" };

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
    // Validate parameters
    if (!questionId || !questionId.startsWith('0x')) {
      console.warn("[seed-market-liquidity] Invalid questionId", { questionId });
      return false;
    }
    
    if (!amountUsdc || amountUsdc <= 0) {
      console.warn("[seed-market-liquidity] Invalid amount", { amountUsdc });
      return false;
    }
    
    // Get current nonce with "pending" to avoid conflicts
    const currentNonce = await clients.public.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    
    // Get current gas prices to ensure we're not underpriced
    const [gasPrice, maxPriorityFeePerGas] = await Promise.all([
      clients.public.getGasPrice(),
      clients.public.estimateMaxPriorityFeePerGas(),
    ]);
    
    // Ensure we have enough gas price to replace any stuck transaction
    const bumpedMaxFeePerGas = gasPrice + BigInt(1000000000); // +1 Gwei
    const bumpedMaxPriorityFeePerGas = maxPriorityFeePerGas + BigInt(1000000000); // +1 Gwei
    
    console.info("[seed-market-liquidity] Attempting seed", { 
      questionId, 
      amountUsdc: amountUsdc.toString(),
      nonce: currentNonce,
      vaultAddress,
      gasPrice: gasPrice.toString(),
      bumpedMaxFeePerGas: bumpedMaxFeePerGas.toString()
    });
    
    const hash = await clients.wallet.writeContract({
      account,
      address: vaultAddress as Hex,
      abi: predictionVaultAbi,
      functionName: "seedMarketLiquidity",
      args: [questionId as Hex, amountUsdc],
      chain: sepolia,
      nonce: currentNonce,
      maxFeePerGas: bumpedMaxFeePerGas,
      maxPriorityFeePerGas: bumpedMaxPriorityFeePerGas,
      gas: 500000n, // 500k gas limit for seeding transactions
    });
    
    // Add timeout for transaction confirmation
    const receipt = await Promise.race([
      clients.public.waitForTransactionReceipt({ hash }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Transaction confirmation timeout after 30 seconds')), 30000)
      )
    ]) as { status: "success" | "reverted" };
    
    const ok = receipt.status === "success";
    if (ok) {
      console.info("[seed-market-liquidity] Seeded", { questionId, hash, status: receipt.status });
    } else {
      console.warn("[seed-market-liquidity] Tx reverted", { questionId, hash, status: receipt.status });
    }
    return ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    
    // Handle specific errors gracefully
    if (msg.includes('could not replace existing tx') || msg.includes('replacement transaction underpriced') || msg.includes('nonce too low')) {
      console.warn("[seed-market-liquidity] Transaction conflict or underpriced, retrying with higher gas...", { questionId, error: msg });
      
      // Wait a bit and retry with even higher gas
      await new Promise(r => setTimeout(r, 3000));
      
      try {
        // Get fresh nonce and gas prices for retry
        const currentNonce = await clients.public.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });
        
        const [gasPrice, maxPriorityFeePerGas] = await Promise.all([
          clients.public.getGasPrice(),
          clients.public.estimateMaxPriorityFeePerGas(),
        ]);
        
        // Even higher gas for retry
        const retryMaxFeePerGas = gasPrice + BigInt(2000000000); // +2 Gwei
        const retryMaxPriorityFeePerGas = maxPriorityFeePerGas + BigInt(2000000000); // +2 Gwei
        
        console.info("[seed-market-liquidity] Retry with higher gas", { 
          questionId, 
          nonce: currentNonce,
          retryMaxFeePerGas: retryMaxFeePerGas.toString()
        });
        
        const hash = await clients.wallet.writeContract({
          account,
          address: vaultAddress as Hex,
          abi: predictionVaultAbi,
          functionName: "seedMarketLiquidity",
          args: [questionId as Hex, amountUsdc],
          chain: sepolia,
          nonce: currentNonce,
          maxFeePerGas: retryMaxFeePerGas,
          maxPriorityFeePerGas: retryMaxPriorityFeePerGas,
          gas: 500000n, // 500k gas limit for seeding transactions
        });
        
        const receipt = await Promise.race([
          clients.public.waitForTransactionReceipt({ hash }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Transaction confirmation timeout after 30 seconds')), 30000)
          )
        ]) as { status: "success" | "reverted" };
        
        const ok = receipt.status === "success";
        if (ok) {
          console.info("[seed-market-liquidity] Retry succeeded", { questionId, hash, status: receipt.status });
        } else {
          console.warn("[seed-market-liquidity] Retry reverted", { questionId, hash, status: receipt.status });
        }
        return ok;
        
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.warn("[seed-market-liquidity] Retry also failed", { questionId, error: retryMsg });
        return false;
      }
    }
    
    if (msg.includes('insufficient funds') || msg.includes('balance')) {
      console.warn("[seed-market-liquidity] Insufficient funds", { questionId, error: msg });
      return false;
    }
    
    console.warn("[seed-market-liquidity] Failed", { questionId, error: msg });
    return false;
  }
}
