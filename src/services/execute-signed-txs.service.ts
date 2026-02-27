/**
 * Broadcasts signed transactions to the chain in order: ETH transfer first (fund wallet),
 * then ERC20 approve, then CT (conditional token) setup.
 */

import type { FastifyBaseLogger } from "fastify";
import { createPublicClient, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { config } from "../config/index.js";

let publicClient: ReturnType<typeof createPublicClient> | null = null;

function getClient(): ReturnType<typeof createPublicClient> | null {
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

/**
 * Sends a single raw signed transaction and waits for the receipt. Returns tx hash on success.
 */
async function sendRaw(
  serialized: Hex,
  label: string,
  log?: FastifyBaseLogger
): Promise<{ hash: Hex } | { error: string }> {
  const client = getClient();
  if (!client) {
    log?.warn("executeSignedTxs: Chain RPC not configured, skipping broadcast");
    return { error: "Chain RPC not configured" };
  }
  log?.info({ label, txLen: serialized.length }, "executeSignedTxs: sending raw tx");
  try {
    const hash = await client.sendRawTransaction({ serializedTransaction: serialized });
    log?.info({ label, hash }, "executeSignedTxs: tx sent, waiting for receipt");
    await client.waitForTransactionReceipt({ hash });
    log?.info({ label, hash }, "executeSignedTxs: tx confirmed");
    return { hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ label, error: msg }, "executeSignedTxs: tx failed");
    return { error: msg };
  }
}

export interface ExecuteSignedTxsResult {
  signedEthTransfer?: { hash: Hex } | { error: string };
  signedErc20?: { hash: Hex } | { error: string };
  signedCT?: { hash: Hex } | { error: string };
}

/**
 * Executes the three signed txs in order: signedEthTransfer, signedErc20, signedCT.
 * Skips any that are missing. Returns per-tx result (hash or error).
 * Pass log to get debug output for each send/receipt.
 */
export async function executeSignedTxs(
  payload: {
    signedEthTransfer?: string;
    signedErc20?: string;
    signedCT?: string;
  },
  log?: FastifyBaseLogger
): Promise<ExecuteSignedTxsResult> {
  const result: ExecuteSignedTxsResult = {};
  if (payload.signedEthTransfer?.trim()) {
    result.signedEthTransfer = await sendRaw(
      payload.signedEthTransfer.trim() as Hex,
      "signedEthTransfer",
      log
    );
  }
  if (payload.signedErc20?.trim()) {
    result.signedErc20 = await sendRaw(payload.signedErc20.trim() as Hex, "signedErc20", log);
  }
  if (payload.signedCT?.trim()) {
    result.signedCT = await sendRaw(payload.signedCT.trim() as Hex, "signedCT", log);
  }
  return result;
}
