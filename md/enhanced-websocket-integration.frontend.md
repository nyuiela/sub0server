# Enhanced WebSocket Integration for Frontend

Comprehensive guide for integrating with the enhanced market-specific WebSocket room system. This system provides granular real-time updates for market details, activities, trades, orderbooks, assets, positions, AI analysis, and agent updates.

---

## 1. Room Structure

The enhanced WebSocket system uses a hierarchical room naming convention:

| Room Pattern | Description | Use Case |
|-------------|-------------|----------|
| `market:{marketId}` | All market activity (public) | Market detail page - order book, trades, general activity |
| `market:{marketId}:activity` | Activity feed only | Activity stream component |
| `market:{marketId}:ai` | AI analysis updates | AI insights panel |
| `market:{marketId}:user:{userId}` | User-scoped market events | User's positions, asset changes in this market |
| `market:{marketId}:agent:{agentId}` | Agent-scoped market events | Specific agent's activity in this market |
| `markets` | All markets list | Markets list page - create/delete notifications |
| `agent:{agentId}` | Global agent updates | Agent detail page - balance, PnL, positions |

### Room Pattern Helpers (from `src/config/index.ts`)

```typescript
import { ROOM_PATTERNS } from '@backend/config';

// Usage examples:
ROOM_PATTERNS.MARKET(marketId);           // `market:${marketId}`
ROOM_PATTERNS.MARKET_USER(marketId, userId);  // `market:${marketId}:user:${userId}`
ROOM_PATTERNS.MARKET_AGENT(marketId, agentId); // `market:${marketId}:agent:${agentId}`
ROOM_PATTERNS.MARKET_ACTIVITY(marketId);  // `market:${marketId}:activity`
ROOM_PATTERNS.MARKET_AI(marketId);        // `market:${marketId}:ai`
ROOM_PATTERNS.AGENT(agentId);             // `agent:${agentId}`
```

---

## 2. Subscribe / Unsubscribe

### Subscribe (client → server)

```json
// Basic subscription
{
  "type": "SUBSCRIBE",
  "payload": {
    "room": "market:550e8400-e29b-41d4-a716-446655440000"
  }
}

// Subscription with event type filters
{
  "type": "SUBSCRIBE",
  "payload": {
    "room": "market:550e8400-e29b-41d4-a716-446655440000",
    "filters": {
      "eventTypes": ["TRADE_EXECUTED", "ORDER_BOOK_UPDATE"]
    }
  }
}

// User-scoped subscription
{
  "type": "SUBSCRIBE",
  "payload": {
    "room": "market:550e8400-e29b-41d4-a716-446655440000:user:user-123"
  }
}

// AI analysis subscription
{
  "type": "SUBSCRIBE",
  "payload": {
    "room": "market:550e8400-e29b-41d4-a716-446655440000:ai"
  }
}
```

### Unsubscribe (client → server)

```json
{
  "type": "UNSUBSCRIBE",
  "payload": {
    "room": "market:550e8400-e29b-41d4-a716-446655440000"
  }
}
```

---

## 3. Events (server → client)

### MARKET_UPDATED

Emitted when market metadata changes (status, liquidity, probability, etc.).

**Payload:**

```typescript
{
  marketId: string;
  reason?: "created" | "updated" | "deleted" | "stats" | "position" | "orderbook" | "liquidity" | "resolved";
  volume?: string;
  liquidity?: string;
  probability?: number;
  status?: string;
}
```

**When each reason is sent:**

| reason | When |
|--------|------|
| `created` | New market created |
| `updated` | Market record updated (name, description, etc.) |
| `deleted` | Market deleted |
| `stats` | Trades persisted, volume updated |
| `position` | Position created/updated/deleted |
| `orderbook` | Order processed, bid/ask changed |
| `liquidity` | Liquidity added/removed |
| `resolved` | Market resolved |

---

### TRADE_EXECUTED

Sent for each executed trade.

**Payload:**

```typescript
{
  tradeId: string;
  positionId?: string;
  marketId: string;
  outcomeIndex?: number;
  side: "long" | "short";
  size: string;
  price: string;
  agentId?: string;
  userId?: string;
  executedAt: string;  // ISO 8601
  txHash?: string;
}
```

**Rooms:** Broadcast to `market:{marketId}` and user's scoped room if userId present.

---

### ACTIVITY_LOG

Rich activity feed entries for market timeline.

**Payload:**

```typescript
{
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
```

**Rooms:** Broadcast to `market:{marketId}:activity` and `market:{marketId}`.

---

### ORDER_BOOK_UPDATE

Order book snapshot after each order processing.

**Payload:**

```typescript
{
  marketId: string;
  outcomeIndex: number;
  bids: { price: string; quantity: string; orderCount?: number }[];
  asks: { price: string; quantity: string; orderCount?: number }[];
  timestamp: number;
}
```

---

### POSITION_UPDATED

User's position changes in a market.

**Payload:**

```typescript
{
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
```

**Rooms:** 
- `market:{marketId}` (public - anonymized)
- `market:{marketId}:user:{userId}` (full details)
- `market:{marketId}:agent:{agentId}` (if agent position)

---

### USER_ASSET_CHANGED

User's collateral/asset changes within a market.

**Payload:**

```typescript
{
  userId: string;
  marketId: string;
  assetType: "collateral" | "position" | "pnl";
  change: string;        // Amount changed (+/-)
  newBalance: string;    // New balance after change
  timestamp: string;
  reason: "trade" | "deposit" | "withdrawal" | "settlement" | "fee";
  txHash?: string;
}
```

**Rooms:** Only `market:{marketId}:user:{userId}` (private to user).

---

### AI_ANALYSIS_UPDATE

AI-generated analysis updates for a market.

**Payload:**

```typescript
{
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
```

**Rooms:** `market:{marketId}:ai` and `market:{marketId}`.

---

### AGENT_UPDATED

Agent record changes (balance, PnL, position count).

**Payload:**

```typescript
{
  agentId: string;
  marketId?: string;     // If market-specific update
  balance?: string;
  pnl?: string;
  activePositions?: number;
  reason?: "balance" | "position" | "market_action" | "sync";
}
```

**Rooms:** 
- `agent:{agentId}` (global agent updates)
- `market:{marketId}:agent:{agentId}` (if market-specific)

---

### AGENT_MARKET_ACTION

Specific agent actions within a market.

**Payload:**

```typescript
{
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
```

**Rooms:** 
- `market:{marketId}`
- `market:{marketId}:agent:{agentId}`
- `agent:{agentId}`

---

## 4. Frontend Implementation Guide

### React Hook Example

```typescript
import { useEffect, useRef, useCallback, useState } from 'react';

interface UseMarketWebSocketProps {
  marketId: string;
  userId?: string;
  agentId?: string;
  onTrade?: (trade: TradeExecutedPayload) => void;
  onPositionUpdate?: (position: PositionUpdatedPayload) => void;
  onActivity?: (activity: ActivityLogPayload) => void;
  onAIAnalysis?: (analysis: AIAnalysisUpdatePayload) => void;
}

export function useMarketWebSocket({
  marketId,
  userId,
  agentId,
  onTrade,
  onPositionUpdate,
  onActivity,
  onAIAnalysis,
}: UseMarketWebSocketProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const subscribedRooms = useRef<Set<string>>(new Set());
  const [isConnected, setIsConnected] = useState(false);

  const subscribe = useCallback((room: string, filters?: RoomFilters) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'SUBSCRIBE',
        payload: { room, filters },
      }));
      subscribedRooms.current.add(room);
    }
  }, []);

  const unsubscribe = useCallback((room: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'UNSUBSCRIBE',
        payload: { room },
      }));
      subscribedRooms.current.delete(room);
    }
  }, []);

  useEffect(() => {
    const ws = new WebSocket(`wss://api.yourapp.com/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      
      // Subscribe to main market room
      subscribe(`market:${marketId}`);
      
      // Subscribe to activity feed
      subscribe(`market:${marketId}:activity`);
      
      // Subscribe to AI updates
      subscribe(`market:${marketId}:ai`);
      
      // Subscribe to user-scoped room if logged in
      if (userId) {
        subscribe(`market:${marketId}:user:${userId}`);
      }
      
      // Subscribe to agent-scoped room if viewing agent
      if (agentId) {
        subscribe(`market:${marketId}:agent:${agentId}`);
      }
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'TRADE_EXECUTED':
          onTrade?.(message.payload);
          break;
        case 'POSITION_UPDATED':
          onPositionUpdate?.(message.payload);
          break;
        case 'ACTIVITY_LOG':
          onActivity?.(message.payload);
          break;
        case 'AI_ANALYSIS_UPDATE':
          onAIAnalysis?.(message.payload);
          break;
        case 'ORDER_BOOK_UPDATE':
          // Update order book state
          break;
        case 'MARKET_UPDATED':
          // Refetch market data or merge payload
          break;
        case 'USER_ASSET_CHANGED':
          // Update user's collateral/position display
          break;
        case 'AGENT_MARKET_ACTION':
          // Show agent action notification
          break;
        case 'PING':
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      subscribedRooms.current.clear();
    };

    return () => {
      // Unsubscribe from all rooms before closing
      subscribedRooms.current.forEach(room => {
        unsubscribe(room);
      });
      ws.close();
    };
  }, [marketId, userId, agentId, subscribe, unsubscribe]);

  return { isConnected, subscribe, unsubscribe };
}
```

---

## 5. Backend Mutation → Broadcast Map

| Mutation | Room(s) | Event | Reason/Note |
|----------|---------|-------|-------------|
| POST /api/markets | `market:{id}`, `markets` | MARKET_UPDATED | created |
| PATCH /api/markets/:id | `market:{id}` | MARKET_UPDATED | updated |
| DELETE /api/markets/:id | `market:{id}`, `markets` | MARKET_UPDATED | deleted |
| POST /api/orders (trade) | `market:{id}`, `market:{id}:user:{userId}`, `market:{id}:agent:{agentId}` | TRADE_EXECUTED, ORDER_BOOK_UPDATE, POSITION_UPDATED | - |
| Trade persistence | `market:{id}`, `market:{id}:activity` | MARKET_UPDATED, ACTIVITY_LOG | stats, trade activity |
| POST /api/positions | `market:{id}`, `market:{id}:user:{userId}` | POSITION_UPDATED, MARKET_UPDATED | position |
| User asset change | `market:{id}:user:{userId}` | USER_ASSET_CHANGED | trade, deposit, withdrawal |
| AI analysis generated | `market:{id}:ai`, `market:{id}` | AI_ANALYSIS_UPDATE | - |
| Agent market action | `market:{id}`, `market:{id}:agent:{agentId}`, `agent:{agentId}` | AGENT_MARKET_ACTION | analyze, bid, ask, trade |
| Agent sync | `agent:{agentId}`, `market:{id}:agent:{agentId}` | AGENT_UPDATED | balance, sync |

---

## 6. Redis Channels (Backend Reference)

| Channel | Purpose | Payload Structure |
|-----------|---------|-------------------|
| `trades` | Trade execution | `{ trade: TradeExecutedPayload }` |
| `order_book_update` | Order book changes | `{ marketId, outcomeIndex, snapshot }` |
| `market_updates` | Market metadata | `{ marketId, reason, volume?, liquidity?, probability?, status? }` |
| `agent_updates` | Agent changes | `{ agentId, marketId?, balance?, pnl?, activePositions?, reason? }` |
| `activity_log` | Activity feed | `{ activity: ActivityLogPayload, room? }` |
| `position_updates` | Position changes | `{ position: PositionUpdatedPayload }` |
| `user_asset_changes` | Asset changes | `{ asset: UserAssetChangedPayload }` |
| `ai_analysis` | AI updates | `{ analysis: AIAnalysisUpdatePayload }` |
| `agent_market_actions` | Agent actions | `{ action: AgentMarketActionPayload }` |

---

## 7. Frontend Checklist

### Market Detail Page
- [ ] Subscribe to `market:{marketId}` for all public updates
- [ ] Subscribe to `market:{marketId}:activity` for activity feed
- [ ] Subscribe to `market:{marketId}:ai` for AI insights
- [ ] If authenticated: Subscribe to `market:{marketId}:user:{userId}` for private updates
- [ ] On `TRADE_EXECUTED`: Update trades list / last trade
- [ ] On `ORDER_BOOK_UPDATE`: Update order book display
- [ ] On `POSITION_UPDATED`: Update user's position panel
- [ ] On `USER_ASSET_CHANGED`: Update collateral balance
- [ ] On `AI_ANALYSIS_UPDATE`: Update AI insights panel
- [ ] On `MARKET_UPDATED`: Refetch market data or merge payload
- [ ] On `ACTIVITY_LOG`: Append to activity feed
- [ ] Reply to PING with PONG
- [ ] Unsubscribe from all rooms when leaving the view

### Agent Detail Page
- [ ] Subscribe to `agent:{agentId}` for global agent updates
- [ ] If viewing specific market: Subscribe to `market:{marketId}:agent:{agentId}`
- [ ] On `AGENT_UPDATED`: Update agent stats (balance, PnL, positions)
- [ ] On `AGENT_MARKET_ACTION`: Show recent actions

### Markets List Page
- [ ] Subscribe to `markets` for create/delete notifications
- [ ] On `MARKET_UPDATED` with `reason: "created"`: Add to list
- [ ] On `MARKET_UPDATED` with `reason: "deleted"`: Remove from list

---

## 8. Example: Complete Market Page Integration

```typescript
function MarketPage({ marketId }: { marketId: string }) {
  const { user } = useAuth();
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis[]>([]);
  const [position, setPosition] = useState<Position | null>(null);

  const { isConnected } = useMarketWebSocket({
    marketId,
    userId: user?.id,
    onTrade: (trade) => {
      setTrades(prev => [trade, ...prev].slice(0, 50));
    },
    onPositionUpdate: (pos) => {
      if (pos.userId === user?.id) {
        setPosition(pos);
      }
    },
    onActivity: (activity) => {
      setActivities(prev => [activity, ...prev]);
    },
    onAIAnalysis: (analysis) => {
      setAiAnalysis(prev => [analysis, ...prev]);
    },
  });

  return (
    <div>
      <ConnectionStatus connected={isConnected} />
      <OrderBook data={orderBook} />
      <PositionPanel position={position} />
      <AIInsights analyses={aiAnalysis} />
      <ActivityFeed activities={activities} />
      <RecentTrades trades={trades} />
    </div>
  );
}
```

---

## 9. Security & Privacy Notes

1. **User-scoped rooms** (`market:{id}:user:{userId}`) only receive events for that specific user
2. **Sensitive data** (asset changes, personal PnL) only sent to user-scoped rooms
3. **Public rooms** show anonymized data (trades without userId, positions without identifying info)
4. **Agent rooms** are accessible to anyone viewing that agent's activity in a market
5. **Authentication** is required for user-scoped subscriptions (validated server-side)

---

## 10. Migration from Legacy System

### Before (Legacy)
```json
{ "type": "SUBSCRIBE", "payload": { "room": "market:123" } }
// Received: TRADE_EXECUTED, ORDER_BOOK_UPDATE, MARKET_UPDATED
```

### After (Enhanced)
```json
// Same basic subscription still works
{ "type": "SUBSCRIBE", "payload": { "room": "market:123" } }
// Now also receives: ACTIVITY_LOG, AI_ANALYSIS_UPDATE, AGENT_MARKET_ACTION

// New: Filtered subscription
{ 
  "type": "SUBSCRIBE", 
  "payload": { 
    "room": "market:123",
    "filters": { "eventTypes": ["TRADE_EXECUTED", "ORDER_BOOK_UPDATE"] }
  } 
}

// New: User-scoped for private updates
{ "type": "SUBSCRIBE", "payload": { "room": "market:123:user:abc" } }
// Receives: POSITION_UPDATED, USER_ASSET_CHANGED

// New: AI-specific room
{ "type": "SUBSCRIBE", "payload": { "room": "market:123:ai" } }
// Receives: AI_ANALYSIS_UPDATE
```

---

**Last Updated:** March 2026
**Version:** 2.0 (Enhanced Room System)
