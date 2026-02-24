import { z } from "zod";

const USERNAME_MAX_LEN = 64;

/** GET response / PATCH body for profile (align with frontend profileSchema). */
export const profileSchema = z.object({
  username: z
    .string()
    .max(USERNAME_MAX_LEN)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : v)),
  email: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v === "" || v == null ? null : v))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "Invalid email" }),
});

/** Vault deposit/withdraw body: amount as string for precision. */
export const vaultAmountSchema = z.object({
  amount: z.string().refine((s) => /^\d+(\.\d+)?$/.test(s) && Number(s) > 0, {
    message: "amount must be a positive number",
  }),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type VaultAmountInput = z.infer<typeof vaultAmountSchema>;
