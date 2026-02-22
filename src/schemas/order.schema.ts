import { z } from "zod";

const orderSideEnum = z.enum(["BID", "ASK"]);
const orderTypeEnum = z.enum(["LIMIT", "MARKET", "IOC"]);

export const orderSubmitSchema = z.object({
  marketId: z.string().uuid(),
  /** Which listed option (e.g. 0 = Yes, 1 = No). Each option has its own order book. */
  outcomeIndex: z.number().int().min(0),
  side: orderSideEnum,
  type: orderTypeEnum,
  price: z.union([z.string(), z.number()]).optional(),
  quantity: z.union([z.string(), z.number()]),
  userId: z.string().uuid().optional().nullable(),
  agentId: z.string().uuid().optional().nullable(),
});

export type OrderSubmitInput = z.infer<typeof orderSubmitSchema>;
