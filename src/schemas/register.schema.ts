import { z } from "zod";
import { AUTH_METHODS } from "../types/register.js";

const authMethodSchema = z.enum(AUTH_METHODS);

const agentCreateSchema = z.object({
  name: z.string().min(1),
  persona: z.string().min(1),
  publicKey: z.string().min(1),
  encryptedPrivateKey: z.string().min(1),
  modelSettings: z.record(z.unknown()),
});

const agentTemplateSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().min(1),
  persona: z.string().optional(),
  publicKey: z.string().min(1),
  encryptedPrivateKey: z.string().min(1),
  modelSettings: z.record(z.unknown()).optional(),
});

export const usernameCheckSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_-]+$/),
});

export const challengeBodySchema = z.object({
  address: z.string().min(1),
});

export const registerBodySchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  address: z.string().min(1),
  authMethod: authMethodSchema,
  verificationMessage: z.string().min(1),
  verificationSignature: z.string().min(1),
  nonce: z.string().min(1),
  delegationMessage: z.string().optional(),
  delegationSignature: z.string().optional(),
  agent: z.union([
    z.object({ create: agentCreateSchema }),
    z.object({ template: agentTemplateSchema }),
  ]),
  email: z.string().email().optional().nullable(),
});

export type UsernameCheckInput = z.infer<typeof usernameCheckSchema>;
export type ChallengeBodyInput = z.infer<typeof challengeBodySchema>;
export type RegisterBodyInput = z.infer<typeof registerBodySchema>;
