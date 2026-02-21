import { z } from "zod";
import { WS_EVENT_NAMES } from "../types/websocket-events.js";

const marketUpdatePayload = z.object({
  marketId: z.string().cuid(),
  symbol: z.string(),
  probability: z.number().min(0).max(1),
  poolLong: z.string(),
  poolShort: z.string(),
  updatedAt: z.string().datetime(),
});

const tradeExecutedPayload = z.object({
  positionId: z.string().cuid(),
  marketId: z.string().cuid(),
  side: z.enum(["long", "short"]),
  size: z.string(),
  price: z.string(),
  agentId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  executedAt: z.string().datetime(),
});

const priceUpdatePayload = z.object({
  symbol: z.string(),
  price: z.string(),
  source: z.string(),
  timestamp: z.string().datetime(),
});

const roomPattern = z.string().regex(/^(market:[a-fA-F0-9-]+|markets)$/);
const subscribePayload = z.object({
  room: roomPattern,
});
const unsubscribePayload = z.object({
  room: roomPattern,
});

const errorPayload = z.object({
  code: z.string(),
  message: z.string(),
});

export const wsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(WS_EVENT_NAMES.MARKET_UPDATE),
    payload: marketUpdatePayload,
    requestId: z.string().optional(),
  }),
  z.object({
    type: z.literal(WS_EVENT_NAMES.TRADE_EXECUTED),
    payload: tradeExecutedPayload,
    requestId: z.string().optional(),
  }),
  z.object({
    type: z.literal(WS_EVENT_NAMES.PRICE_UPDATE),
    payload: priceUpdatePayload,
    requestId: z.string().optional(),
  }),
  z.object({
    type: z.literal(WS_EVENT_NAMES.SUBSCRIBE),
    payload: subscribePayload,
    requestId: z.string().optional(),
  }),
  z.object({
    type: z.literal(WS_EVENT_NAMES.UNSUBSCRIBE),
    payload: unsubscribePayload,
    requestId: z.string().optional(),
  }),
  z.object({
    type: z.literal(WS_EVENT_NAMES.PING),
    payload: z.undefined().optional(),
    requestId: z.string().optional(),
  }),
  z.object({
    type: z.literal(WS_EVENT_NAMES.PONG),
    payload: z.undefined().optional(),
    requestId: z.string().optional(),
  }),
  z.object({
    type: z.literal(WS_EVENT_NAMES.ERROR),
    payload: errorPayload,
    requestId: z.string().optional(),
  }),
]);

export type WsMessageParsed = z.infer<typeof wsMessageSchema>;

export const subscribeMessageSchema = z.object({
  type: z.literal(WS_EVENT_NAMES.SUBSCRIBE),
  payload: subscribePayload,
  requestId: z.string().optional(),
});

export const unsubscribeMessageSchema = z.object({
  type: z.literal(WS_EVENT_NAMES.UNSUBSCRIBE),
  payload: unsubscribePayload,
  requestId: z.string().optional(),
});

export const pingMessageSchema = z.object({
  type: z.literal(WS_EVENT_NAMES.PING),
  payload: z.undefined().optional(),
  requestId: z.string().optional(),
});
