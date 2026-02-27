# Frontend WebSocket Integration

Report for frontend WebSocket integration with the backend. All market-related changes are broadcast so users do not need to refresh to get new information.

---

## 1. Rooms

| Room | Use |
|------|-----|
| `market:{marketId}` | Subscribe to receive all updates for one market (order book, trades, market record, positions). |
| `markets` | Subscribe to receive create/delete notifications so the list view can refetch. |
| `agent:{agentId}` | Subscribe to receive agent updates (e.g. balance synced from chain). |

**Subscribe (client -> server):**

```json
{ "type": "SUBSCRIBE", "payload": { "room": "market:<marketId>" } }
{ "type": "SUBSCRIBE", "payload": { "room": "markets" } }
{ "type": "SUBSCRIBE", "payload": { "room": "agent:<agentId>" } }
```

Room format: `market:` + UUID, literal `markets`, or `agent:` + agent UUID.

---

## 2. Events (server -> client)

### MARKET_UPDATED

Emitted whenever the market or related data changes. Frontend should refetch `GET /api/markets/:id` or update local state (e.g. volume).

**Payload:**

```ts
{
  marketId: string;
  reason?: "created" | "updated" | "deleted" | "stats" | "position" | "orderbook";
  volume?: string;
}
```

**When each reason is sent:**

| reason | When |
|--------|------|
| `created` | New market created (POST /api/markets). Also sent to room `markets`. |
| `updated` | Market record updated (PATCH /api/markets/:id), e.g. name, status, liquidity, confidence, pnl. |
| `deleted` | Market deleted (DELETE /api/markets/:id). Also sent to room `markets`. |
| `stats` | Trades persisted; market volume updated. |
| `position` | Position created, updated, or deleted (POST/PATCH/DELETE /api/positions). |
| `orderbook` | Order processed (bid/ask); order book and/or liquidity changed. |

**Example:**

```json
{
  "type": "MARKET_UPDATED",
  "payload": {
    "marketId": "1d5c64ea-c561-4e69-888b-3bc84d2f1f07",
    "reason": "stats",
    "volume": "150.25"
  }
}
```

### ORDER_BOOK_UPDATE

Sent after each order is processed. Use to replace or patch the local order book.

**Payload:** `marketId`, `bids`, `asks` (array of `{ price, quantity, orderCount? }`), `timestamp`.

### TRADE_EXECUTED

Sent for each fill when an order matches.

**Payload:** `marketId`, `side` ("long" | "short"), `size`, `price`, `executedAt` (ISO string), optional `userId`, `agentId`.

### AGENT_UPDATED

Emitted when an agent record changes (e.g. balance synced from chain via POST /api/agents/:id/sync-balance). Subscribe to room `agent:{agentId}` to receive.

**Payload:**

```ts
{
  agentId: string;
  balance?: string;
  reason?: "balance";
}
```

On `AGENT_UPDATED`, refetch the agent (GET /api/agents/:id) or merge `payload.balance` into local state.

### PING / PONG

Server sends PING; client should reply with PONG to avoid disconnection.

### ERROR

**Payload:** `{ code, message }`.

---

## 3. Flow summary

- **New market:** Subscribe to `market:{newMarketId}` for detail; subscribe to `markets` for list. On `MARKET_UPDATED` with `reason: "created"` (in `markets`), refetch list.
- **Market detail:** Subscribe to `market:{marketId}`. On `MARKET_UPDATED` (any reason), `ORDER_BOOK_UPDATE`, or `TRADE_EXECUTED`, refetch market or merge payload.
- **Bid/ask:** Order book and trades are pushed via `ORDER_BOOK_UPDATE` and `TRADE_EXECUTED`; then `MARKET_UPDATED` with `reason: "orderbook"` and later `reason: "stats"` (after persistence) so volume and stats stay in sync.

---

## 4. Backend mutation -> broadcast map

| Mutation | Room(s) | Event | reason |
|----------|---------|--------|--------|
| POST /api/markets | market:{id}, markets | MARKET_UPDATED | created |
| PATCH /api/markets/:id | market:{id} | MARKET_UPDATED | updated |
| DELETE /api/markets/:id | market:{id}, markets | MARKET_UPDATED | deleted |
| Trade persistence (worker) | market:{id} | MARKET_UPDATED | stats |
| POST/PATCH/DELETE /api/positions | market:{id} | MARKET_UPDATED | position |
| Order processed (engine) | market:{id} | ORDER_BOOK_UPDATE, TRADE_EXECUTED, MARKET_UPDATED | orderbook |
| POST /api/agents/:id/sync-balance (when balance changed) | agent:{id} | AGENT_UPDATED | balance |

---

## 5. Frontend checklist

- [ ] Subscribe to `market:{marketId}` when viewing a market.
- [ ] Subscribe to `markets` when on the markets list.
- [ ] Subscribe to `agent:{agentId}` when viewing an agent detail; on `AGENT_UPDATED` update balance in state or refetch agent.
- [ ] On `MARKET_UPDATED`: refetch market or merge `volume`; on `reason: "deleted"` remove from state or redirect.
- [ ] On `ORDER_BOOK_UPDATE`: update local order book.
- [ ] On `TRADE_EXECUTED`: update trades list / last trade.
- [ ] Reply to PING with PONG.
- [ ] Unsubscribe from rooms when leaving the view.
