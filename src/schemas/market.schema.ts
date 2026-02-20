import { z } from "zod";

const marketStatusEnum = z.enum(["OPEN", "RESOLVING", "CLOSED", "DISPUTED"]);

export const marketCreateSchema = z.object({
  name: z.string().min(1),
  creatorAddress: z.string().min(1),
  context: z.string().optional().nullable(),
  outcomes: z.array(z.unknown()),
  sourceUrl: z.string().url().optional().nullable(),
  resolutionDate: z.string().datetime(),
  oracleAddress: z.string().min(1),
  collateralToken: z.string().min(1),
  conditionId: z.string().min(1),
});

export const marketUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  context: z.string().optional().nullable(),
  outcomes: z.array(z.unknown()).optional(),
  sourceUrl: z.string().url().optional().nullable(),
  resolutionDate: z.string().datetime().optional(),
  oracleAddress: z.string().min(1).optional(),
  status: marketStatusEnum.optional(),
});

export const marketQuerySchema = z.object({
  status: marketStatusEnum.optional(),
  creatorAddress: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type MarketCreateInput = z.infer<typeof marketCreateSchema>;
export type MarketUpdateInput = z.infer<typeof marketUpdateSchema>;
export type MarketQueryInput = z.infer<typeof marketQuerySchema>;
