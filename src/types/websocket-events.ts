export const WS_EVENT_NAMES = {
  MARKET_UPDATE: "MARKET_UPDATE",
  TRADE_EXECUTED: "TRADE_EXECUTED",
  PRICE_UPDATE: "PRICE_UPDATE",
  SUBSCRIBE: "SUBSCRIBE",
  UNSUBSCRIBE: "UNSUBSCRIBE",
  PING: "PING",
  PONG: "PONG",
  ERROR: "ERROR",
} as const;

export type WsEventName = (typeof WS_EVENT_NAMES)[keyof typeof WS_EVENT_NAMES];

export interface MarketUpdatePayload {
  marketId: string;
  symbol: string;
  probability: number;
  poolLong: string;
  poolShort: string;
  updatedAt: string;
}

export interface TradeExecutedPayload {
  positionId: string;
  marketId: string;
  side: "long" | "short";
  size: string;
  price: string;
  agentId?: string;
  userId?: string;
  executedAt: string;
}

export interface PriceUpdatePayload {
  symbol: string;
  price: string;
  source: string;
  timestamp: string;
}

export interface SubscribePayload {
  room: string;
}

export interface UnsubscribePayload {
  room: string;
}

export interface WsErrorPayload {
  code: string;
  message: string;
}

export type WsEventPayloadMap = {
  [WS_EVENT_NAMES.MARKET_UPDATE]: MarketUpdatePayload;
  [WS_EVENT_NAMES.TRADE_EXECUTED]: TradeExecutedPayload;
  [WS_EVENT_NAMES.PRICE_UPDATE]: PriceUpdatePayload;
  [WS_EVENT_NAMES.SUBSCRIBE]: SubscribePayload;
  [WS_EVENT_NAMES.UNSUBSCRIBE]: UnsubscribePayload;
  [WS_EVENT_NAMES.PING]: undefined;
  [WS_EVENT_NAMES.PONG]: undefined;
  [WS_EVENT_NAMES.ERROR]: WsErrorPayload;
};

export interface WsMessage<E extends WsEventName = WsEventName> {
  type: E;
  payload: WsEventPayloadMap[E];
  requestId?: string;
}

export type WsMessageMap = {
  [K in WsEventName]: WsMessage<K>;
};
