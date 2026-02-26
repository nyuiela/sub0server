import { z } from "zod";

const agentStatusEnum = z.enum(["ACTIVE", "PAUSED", "DEPLETED", "EXPIRED"]);

/** Placeholders when creating agent without keys; create-wallet (CRE) will set walletAddress. */
export const CRE_PENDING_PUBLIC_KEY = "0x0000000000000000000000000000000000000000";
export const CRE_PENDING_PRIVATE_KEY = "CRE_PENDING";

export const agentCreateSchema = z.object({
  ownerId: z.string().uuid(),
  name: z.string().min(1),
  persona: z.string().min(1),
  /** Optional: when omitted, backend uses placeholder and caller should call create-wallet (CRE) next. */
  publicKey: z.string().min(1).optional(),
  /** Optional: when omitted, backend uses placeholder and caller should call create-wallet (CRE) next. */
  encryptedPrivateKey: z.string().min(1).optional(),
  modelSettings: z.record(z.unknown()),
  templateId: z.string().uuid().optional().nullable(),
});

const PERSONA_MAX_LEN = 50_000;

export const agentUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  persona: z.string().min(1).max(PERSONA_MAX_LEN).optional(),
  encryptedPrivateKey: z.string().min(1).optional(),
  modelSettings: z.record(z.unknown()).optional(),
  status: agentStatusEnum.optional(),
  templateId: z.string().uuid().optional().nullable(),
});

export const agentQuerySchema = z.object({
  ownerId: z.string().uuid().optional(),
  status: agentStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/** Public list: no auth; only status, limit, offset (no ownerId). */
export const agentPublicListSchema = z.object({
  status: agentStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type AgentCreateInput = z.infer<typeof agentCreateSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;
export type AgentQueryInput = z.infer<typeof agentQuerySchema>;
export type AgentPublicListInput = z.infer<typeof agentPublicListSchema>;
