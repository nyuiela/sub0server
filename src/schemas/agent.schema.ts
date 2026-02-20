import { z } from "zod";

const agentStatusEnum = z.enum(["ACTIVE", "PAUSED", "DEPLETED", "EXPIRED"]);

export const agentCreateSchema = z.object({
  ownerId: z.string().uuid(),
  name: z.string().min(1),
  persona: z.string().min(1),
  publicKey: z.string().min(1),
  encryptedPrivateKey: z.string().min(1),
  modelSettings: z.record(z.unknown()),
  templateId: z.string().uuid().optional().nullable(),
});

export const agentUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  persona: z.string().min(1).optional(),
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

export type AgentCreateInput = z.infer<typeof agentCreateSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;
export type AgentQueryInput = z.infer<typeof agentQuerySchema>;
