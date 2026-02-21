import { z } from "zod";

export const activitiesQuerySchema = z.object({
  marketId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  types: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ActivitiesQueryInput = z.infer<typeof activitiesQuerySchema>;
