import { z } from "zod";
import { AUTH_METHODS } from "../types/register.js";

const authMethodSchema = z.enum(AUTH_METHODS);

const agentCreateSchema = z.object({
  name: z.string().min(1).max(120),
  persona: z.string().min(1).max(2000).optional(),
  modelSettings: z.record(z.unknown()).optional(),
});

const agentTemplateSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().min(1).max(120),
  persona: z.string().min(1).max(2000).optional(),
  modelSettings: z.record(z.unknown()).optional(),
});

export const usernameCheckSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_-]+$/),
});

export const registerBodySchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  authMethod: authMethodSchema,
  agent: z.union([
    z.object({ create: agentCreateSchema }),
    z.object({ template: agentTemplateSchema }),
  ]),
  email: z.string().email().optional().nullable(),
});

export type UsernameCheckInput = z.infer<typeof usernameCheckSchema>;
export type RegisterBodyInput = z.infer<typeof registerBodySchema>;
