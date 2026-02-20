import { z } from "zod";

export const userCreateSchema = z.object({
  address: z.string().min(1),
  email: z.string().email().optional().nullable(),
});

export const userUpdateSchema = z.object({
  email: z.string().email().optional().nullable(),
});

export const userQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
