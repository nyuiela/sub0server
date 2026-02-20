import { z } from "zod";

export const toolCreateSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  description: z.string().min(1),
  fee: z.string(),
  receiverAddress: z.string().min(1),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  provider: z.string().min(1),
});

export const toolUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().url().optional(),
  description: z.string().min(1).optional(),
  fee: z.string().optional(),
  receiverAddress: z.string().min(1).optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  provider: z.string().min(1).optional(),
});

export const toolQuerySchema = z.object({
  provider: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ToolCreateInput = z.infer<typeof toolCreateSchema>;
export type ToolUpdateInput = z.infer<typeof toolUpdateSchema>;
export type ToolQueryInput = z.infer<typeof toolQuerySchema>;
