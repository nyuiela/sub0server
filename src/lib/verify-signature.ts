import { recoverMessageAddress } from "viem";

export async function recoverAddressFromSignature(message: string, signature: `0x${string}`): Promise<string | null> {
  try {
    const address = await recoverMessageAddress({ message, signature });
    return address?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function normalizeAddress(addr: string): string {
  return addr.startsWith("0x") ? addr.toLowerCase() : `0x${addr.toLowerCase()}`;
}
