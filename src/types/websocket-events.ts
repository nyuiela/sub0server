export const WS_EVENT_NAMES = {
  // Market-level events
  MARKET_UPDATE: "MARKET_UPDATE",
  MARKET_UPDATED: "MARKET_UPDATED",
  MARKET_STATS_UPDATED: "MARKET_STATS_UPDATED",

  // Activity & Trade events
  TRADE_EXECUTED: "TRADE_EXECUTED",
  ACTIVITY_LOG: "ACTIVITY_LOG",

  // Order book
  ORDER_BOOK_UPDATE: "ORDER_BOOK_UPDATE",
  PRICE_UPDATE: "PRICE_UPDATE",

  // User-specific within market
  POSITION_UPDATED: "POSITION_UPDATED",
  USER_ASSET_CHANGED: "USER_ASSET_CHANGED",

  // AI & Agent events
  AI_ANALYSIS_UPDATE: "AI_ANALYSIS_UPDATE",
  AGENT_UPDATED: "AGENT_UPDATED",
  AGENT_MARKET_ACTION: "AGENT_MARKET_ACTION",

  // Control events
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

/** Emitted when trade persistence updates market volume (and optionally other stats). */
export interface MarketStatsUpdatedPayload {
  marketId: string;
  volume: string;
  totalTrades?: number;
  lastTradeAt?: string;
}

/** Emitted when market or related data changes (create, update, delete, trades, positions, etc.). */
export interface MarketUpdatedPayload {
  marketId: string;
  reason?: "created" | "updated" | "deleted" | "stats" | "position" | "orderbook" | "liquidity" | "resolved";
  volume?: string;
  liquidity?: string;
  probability?: number;
  status?: string;
}

/** Activity log entry for market feed */
export interface ActivityLogPayload {
  marketId: string;
  activityId: string;
  type: "trade" | "order" | "position" | "liquidity" | "agent" | "system";
  timestamp: string;
  actor?: {
    type: "user" | "agent" | "system";
    id?: string;
    name?: string;
  };
  summary: string;
  details?: Record<string, unknown>;
}

export interface TradeExecutedPayload {
  tradeId: string;
  positionId?: string;
  marketId: string;
  outcomeIndex?: number;
  side: "long" | "short";
  size: string;
  price: string;
  agentId?: string;
  userId?: string;
  executedAt: string;
  txHash?: string;
}

/** Position update - emitted when user's position in a market changes */
export interface PositionUpdatedPayload {
  positionId: string;
  marketId: string;
  userId?: string;
  agentId?: string;
  outcomeIndex: number;
  side: "long" | "short";
  size: string;
  avgPrice: string;
  pnl?: string;
  status: "open" | "closed" | "partial";
  updatedAt: string;
  reason: "created" | "increased" | "decreased" | "closed" | "liquidated";
}

/** User asset change - emitted when user's balance/assets change */
export interface UserAssetChangedPayload {
  userId: string;
  marketId: string;
  assetType: "collateral" | "position" | "pnl";
  change: string;
  newBalance: string;
  timestamp: string;
  reason: "trade" | "deposit" | "withdrawal" | "settlement" | "fee";
  txHash?: string;
}

/** AI analysis update for a market */
export interface AIAnalysisUpdatePayload {
  marketId: string;
  analysisId: string;
  source: "gemini" | "grok" | "openwebui" | "system";
  timestamp: string;
  type: "sentiment" | "price_prediction" | "risk_assessment" | "market_summary";
  data: {
    sentiment?: "bullish" | "bearish" | "neutral";
    confidence?: number;
    priceTarget?: string;
    reasoning?: string;
    indicators?: Record<string, number | string>;
  };
  expiresAt?: string;
}

/** Agent action within a specific market */
export interface AgentMarketActionPayload {
  marketId: string;
  agentId: string;
  actionId: string;
  timestamp: string;
  action: "analyze" | "bid" | "ask" | "trade" | "alert" | "rebalance";
  status: "pending" | "executed" | "failed" | "cancelled";
  details?: {
    orderId?: string;
    tradeId?: string;
    size?: string;
    price?: string;
    reasoning?: string;
  };
}

/** Order book snapshot from matching engine (ORDER_BOOK_UPDATE). One per outcome (e.g. Yes=0, No=1). */
export interface OrderBookUpdatePayload {
  marketId: string;
  outcomeIndex: number;
  bids: { price: string; quantity: string; orderCount?: number }[];
  asks: { price: string; quantity: string; orderCount?: number }[];
  timestamp: number;
}

export interface PriceUpdatePayload {
  symbol: string;
  price: string;
  source: string;
  timestamp: string;
}

/** Emitted when agent record changes (e.g. balance synced from chain). */
export interface AgentUpdatedPayload {
  agentId: string;
  marketId?: string;
  balance?: string;
  pnl?: string;
  activePositions?: number;
  reason?: "balance" | "position" | "market_action" | "sync";
}

export interface SubscribePayload {
  room: string;
  filters?: {
    eventTypes?: WsEventName[];
    userScoped?: boolean;
    agentId?: string;
  };
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
  [WS_EVENT_NAMES.MARKET_UPDATED]: MarketUpdatedPayload;
  [WS_EVENT_NAMES.MARKET_STATS_UPDATED]: MarketStatsUpdatedPayload;
  [WS_EVENT_NAMES.TRADE_EXECUTED]: TradeExecutedPayload;
  [WS_EVENT_NAMES.ACTIVITY_LOG]: ActivityLogPayload;
  [WS_EVENT_NAMES.ORDER_BOOK_UPDATE]: OrderBookUpdatePayload;
  [WS_EVENT_NAMES.PRICE_UPDATE]: PriceUpdatePayload;
  [WS_EVENT_NAMES.POSITION_UPDATED]: PositionUpdatedPayload;
  [WS_EVENT_NAMES.USER_ASSET_CHANGED]: UserAssetChangedPayload;
  [WS_EVENT_NAMES.AI_ANALYSIS_UPDATE]: AIAnalysisUpdatePayload;
  [WS_EVENT_NAMES.AGENT_UPDATED]: AgentUpdatedPayload;
  [WS_EVENT_NAMES.AGENT_MARKET_ACTION]: AgentMarketActionPayload;
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
