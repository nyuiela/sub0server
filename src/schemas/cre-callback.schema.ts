import { z } from "zod";

/** CRE gateway calls this after createAgentKey (Option 1 or 2). */
export const creCreateWalletResultSchema = z.object({
  agentId: z.string().uuid(),
  address: z.string().min(1).refine((s) => s.startsWith("0x"), "Must be 0x address"),
  /** Option 2: CRE-only ciphertext; backend stores but never decrypts. Omit for Option 1 (key stored only in CRE). */
  encryptedPrivateKey: z.string().min(1).optional(),
});

export type CreCreateWalletResultInput = z.infer<typeof creCreateWalletResultSchema>;
