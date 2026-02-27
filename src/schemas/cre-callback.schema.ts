import { z } from "zod";

/** CRE gateway calls this after createAgentKey (Option 1 or 2). */
export const creCreateWalletResultSchema = z.object({
  agentId: z.string().uuid(),
  address: z.string().min(1).refine((s) => s.startsWith("0x"), "Must be 0x address"),
  /** Option 2: CRE-only ciphertext; backend stores but never decrypts. Omit for Option 1 (key stored only in CRE). */
  encryptedPrivateKey: z.string().min(1).optional(),
});

export type CreCreateWalletResultInput = z.infer<typeof creCreateWalletResultSchema>;

/** Optional hex string (empty or 0x-prefixed). Empty strings are skipped when executing. */
const optionalHex = z.string().optional().transform((s) => (s?.trim()?.startsWith("0x") ? s.trim() : undefined));

/** POST /api/cre/agent-keys – CRE sends address, encryptedKeyBlob, and signed txs. agentId optional (required for storing). */
export const creAgentKeysSchema = z.object({
  agentId: z.string().uuid().optional(),
  address: z.string().min(1).refine((s) => s.startsWith("0x"), "Must be 0x address"),
  encryptedKeyBlob: z.string().optional(),
  signedCT: optionalHex,
  signedErc20: optionalHex,
  signedEthTransfer: optionalHex,
});

export type CreAgentKeysInput = z.infer<typeof creAgentKeysSchema>;
