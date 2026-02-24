import { z } from "zod";

export const userCreateSchema = z.object({
  address: z.string().min(1),
  email: z.string().email().optional().nullable(),
});

const USERNAME_MAX_LEN = 64;

export const userUpdateSchema = z.object({
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

export const userQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
