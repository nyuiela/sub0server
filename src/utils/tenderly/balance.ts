/**
 * Read native and ERC20 balances from the Tenderly chain via public RPC.
 */

async function rpcRequest<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = (await res.json()) as { error?: { message?: string }; result?: T };
  if (data.error?.message) throw new Error(data.error.message);
  return data.result as T;
}

export async function getNativeBalance(rpcUrl: string, address: string): Promise<bigint> {
  const normalized = address.startsWith("0x") ? address : `0x${address}`;
  const hex = await rpcRequest<string>(rpcUrl, "eth_getBalance", [normalized, "latest"]);
  if (hex == null || hex === "") return BigInt(0);
  return BigInt(hex);
}

const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";

function padAddressTo32Bytes(addr: string): string {
  const a = addr.startsWith("0x") ? addr.slice(2) : addr;
  return "0x" + a.padStart(64, "0").toLowerCase();
}

export async function getErc20Balance(
  rpcUrl: string,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  const normalized = walletAddress.startsWith("0x") ? walletAddress : `0x${walletAddress}`;
  const data =
    ERC20_BALANCE_OF_SELECTOR + padAddressTo32Bytes(normalized).slice(2);
  const hex = await rpcRequest<string>(rpcUrl, "eth_call", [
    {
      to: tokenAddress.startsWith("0x") ? tokenAddress : `0x${tokenAddress}`,
      data,
    },
    "latest",
  ]);
  if (hex == null || hex === "") return BigInt(0);
  return BigInt(hex);
}
