import { z } from "zod";

const orderSideEnum = z.enum(["BID", "ASK"]);
const orderTypeEnum = z.enum(["LIMIT", "MARKET", "IOC"]);

export const orderSubmitSchema = z
  .object({
    marketId: z.string().uuid(),
    outcomeIndex: z.number().int().min(0),
    side: orderSideEnum,
    type: orderTypeEnum,
    price: z.union([z.string(), z.number()]).optional(),
    quantity: z.union([z.string(), z.number()]),
    userId: z.string().uuid().optional().nullable(),
    agentId: z.string().uuid().optional().nullable(),
    userSignature: z.string().optional(),
    tradeCostUsdc: z.string().optional(),
    nonce: z.string().optional(),
    deadline: z.string().optional(),
  })
  .refine(
    (data) => {
      const isUserOrder = data.userId != null && data.userId !== "" && (data.agentId == null || data.agentId === "");
      if (!isUserOrder) return true;
      return (
        data.userSignature != null &&
        data.userSignature !== "" &&
        data.tradeCostUsdc != null &&
        data.tradeCostUsdc !== "" &&
        data.nonce != null &&
        data.deadline != null
      );
    },
    { message: "User orders require userSignature, tradeCostUsdc, nonce, and deadline" }
  );

export type OrderSubmitInput = z.infer<typeof orderSubmitSchema>;
