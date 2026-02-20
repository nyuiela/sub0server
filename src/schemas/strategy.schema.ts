import { z } from "zod";

const strategyPrefEnum = z.enum(["AMM_ONLY", "ORDERBOOK", "HYBRID"]);

export const agentStrategyCreateSchema = z.object({
  agentId: z.string().uuid(),
  preference: strategyPrefEnum.optional().default("HYBRID"),
  maxSlippage: z.number().min(0),
  spreadTolerance: z.number().min(0),
});

export const agentStrategyUpdateSchema = z.object({
  preference: strategyPrefEnum.optional(),
  maxSlippage: z.number().min(0).optional(),
  spreadTolerance: z.number().min(0).optional(),
});

export type AgentStrategyCreateInput = z.infer<typeof agentStrategyCreateSchema>;
export type AgentStrategyUpdateInput = z.infer<typeof agentStrategyUpdateSchema>;
