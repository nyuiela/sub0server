import { z } from "zod";

const agentSourceSchema = z.enum(["gemini", "grok", "openwebui"]).optional();

export const onchainMarketCreatedSchema = z.object({
  questionId: z.string().min(1),
  createMarketTxHash: z.string().min(1),
  seedTxHash: z.string().min(1),
  question: z.string().min(1),
  oracle: z.string().min(1),
  creatorAddress: z.string().min(1),
  duration: z.number().int().positive(),
  outcomeSlotCount: z.number().int().min(2).max(255),
  oracleType: z.number().int().min(0),
  marketType: z.number().int().min(0),
  agentSource: agentSourceSchema,
});

export type OnchainMarketCreatedInput = z.infer<typeof onchainMarketCreatedSchema>;

export const onchainMarketCreatedBatchSchema = z.object({
  markets: z.array(onchainMarketCreatedSchema).min(1).max(100),
});

export type OnchainMarketCreatedBatchInput = z.infer<typeof onchainMarketCreatedBatchSchema>;

export const agentMarketsQuerySchema = z.object({
  count: z.coerce.number().int().min(1).max(50).optional(),
});

export type AgentMarketsQueryInput = z.infer<typeof agentMarketsQuerySchema>;
