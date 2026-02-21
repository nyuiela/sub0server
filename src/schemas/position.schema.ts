import { z } from "zod";

const positionSideEnum = z.enum(["LONG", "SHORT"]);
const positionStatusEnum = z.enum(["OPEN", "CLOSED", "LIQUIDATED"]);

export const positionCreateSchema = z.object({
  marketId: z.string().uuid(),
  userId: z.string().uuid().optional().nullable(),
  agentId: z.string().uuid().optional().nullable(),
  address: z.string().min(1),
  tokenAddress: z.string().min(1),
  outcomeIndex: z.number().int().min(0),
  side: positionSideEnum,
  avgPrice: z.string(),
  collateralLocked: z.string(),
  isAmm: z.boolean().optional().default(false),
  contractPositionId: z.string().min(1).optional().nullable(),
});

export const positionUpdateSchema = z.object({
  status: positionStatusEnum.optional(),
  contractPositionId: z.string().min(1).optional().nullable(),
});

export const positionQuerySchema = z.object({
  marketId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  address: z.string().optional(),
  status: positionStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type PositionCreateInput = z.infer<typeof positionCreateSchema>;
export type PositionUpdateInput = z.infer<typeof positionUpdateSchema>;
export type PositionQueryInput = z.infer<typeof positionQuerySchema>;
