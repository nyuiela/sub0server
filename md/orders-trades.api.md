# Orders and Trades API Reference

Reference for frontend integration: submitting orders, how trades are stored, and how to read order and trade data.

---

## Overview

- **Orders**: Submitted via `POST /api/orders`. Each order is for one **listed option** (outcome) of a market (e.g. outcome 0 = Yes, 1 = No). Buy/sell is per option: you buy or sell tokens for that outcome. Orders are processed per (market, outcome) and persisted with `outcomeIndex`. There is no dedicated "list orders" REST endpoint.
- **Trades**: Trades are created when orders match (buy vs sell) for the same outcome. They are persisted with `outcomeIndex`. A background worker also creates or updates **Position** records (LONG/SHORT per outcome) when trades execute.

---

## Orders API

### Submit order

**`POST /api/orders`**

Submit a buy (BID) or sell (ASK) order for **one listed option** of a market (e.g. Yes token = outcome 0, No token = outcome 1). Each option has its own order book. The order is processed for that (market, outcome); the response includes the order id, any trades that executed, and the updated order book snapshot for that outcome.

**Authentication:** Either a logged-in user (JWT) or an API key.

- **User (frontend):** Send the JWT in a cookie (configured name or `jwt`), or `Authorization: Bearer <token>`, or query `?token=<jwt>`. The backend resolves the user from the JWT and sets `userId` on the order automatically; do not send `userId` or `agentId` in the body when using user auth.
- **API key (server/scripts):** Send `x-api-key` or `api-key` header. You may optionally send `userId` or `agentId` in the body to attribute the order.

**Request body**

| Field         | Type   | Required | Description |
|---------------|--------|----------|-------------|
| marketId      | string | Yes      | UUID of the market. |
| outcomeIndex  | number | Yes      | Index of the listed option (e.g. 0 = Yes, 1 = No). Must be &lt; market's outcome count. |
| side          | string | Yes      | `"BID"` (buy this option) or `"ASK"` (sell this option). |
| type          | string | Yes      | `"LIMIT"`, `"MARKET"`, or `"IOC"`. |
| price         | string or number | For LIMIT only | Limit price. Required when `type` is `LIMIT`. |
| quantity      | string or number | Yes | Order size. |
| userId        | string | No (API key only) | UUID of the user. When using user auth (JWT), this is set from the token; do not send it. |
| agentId       | string | No (API key only) | UUID of the agent. Only accepted when using API key. |
| userSignature | string | Yes (user orders) | EIP-712 LMSRQuote signature (0x-prefixed hex). Required when the order is attributed to a user (no agentId). Stored and sent to CRE when the order is filled so the trade executes on-chain. |
| tradeCostUsdc | string | Yes (user orders) | Trade cost in USDC units (decimal string) for the signed quote. Must match the quote the user signed. |
| nonce         | string | Yes (user orders) | Nonce used in the EIP-712 quote. |
| deadline      | string | Yes (user orders) | EIP-712 deadline (unix timestamp string). |

**CRE execution on fill**

- **User orders:** When the order is attributed to a user (userId, no agentId), the backend requires `userSignature`, `tradeCostUsdc`, `nonce`, and `deadline`. These are stored in the order pool. When the order becomes **FILLED**, the backend sends one execute-trade request to CRE with the stored signature and quote params; CRE adds the DON signature and submits the trade on-chain.
- **Agent orders:** When the order is attributed to an agent (agentId), no signature is sent with the order. When the order is filled (each fill), the backend calls CRE **executeConfidentialTrade** with the agent id; CRE signs with the agent key and DON and submits each fill on-chain.

- **LIMIT**: Resting order at the given price; can fill immediately if the book has a matching opposite side.
- **MARKET**: Fills at best available price(s); no resting quantity.
- **IOC** (Immediate-or-Cancel): Fills what is available now and cancels the rest.

**Example** (buy Yes tokens at 0.45)

```json
{
  "marketId": "550e8400-e29b-41d4-a716-446655440000",
  "outcomeIndex": 0,
  "side": "BID",
  "type": "LIMIT",
  "price": "0.45",
  "quantity": "100"
}
```

**Response (201)**

```json
{
  "orderId": "uuid-of-the-submitted-order",
  "trades": [
    {
      "id": "trade-...",
      "marketId": "550e8400-e29b-41d4-a716-446655440000",
      "outcomeIndex": 0,
      "price": "0.45",
      "quantity": "50.000000000000000000",
      "makerOrderId": "uuid-of-resting-order",
      "takerOrderId": "uuid-of-submitted-order",
      "side": "BID",
      "userId": null,
      "agentId": null,
      "executedAt": 1734567890123
    }
  ],
  "snapshot": {
    "marketId": "550e8400-e29b-41d4-a716-446655440000",
    "outcomeIndex": 0,
    "bids": [{ "price": "0.45", "quantity": "50.000000000000000000", "orderCount": 1 }],
    "asks": [],
    "timestamp": 1734567890123
  }
}
```

- **orderId**: Server-generated UUID for this order. The order is stored in the database after processing (status: e.g. `FILLED`, `PARTIALLY_FILLED`, `LIVE`, `REJECTED`, `CANCELLED`).
- **trades**: Array of trades that executed for this order (taker vs maker). May be empty if the order did not match or is resting.
- **snapshot**: Order book state for that (market, outcome) after this order was applied. Includes `outcomeIndex`.

**Errors**

- **400**: Validation failed (e.g. missing `price` for LIMIT, invalid body, `outcomeIndex` out of range). Response includes `error` and `details` or `message`.
- **404**: Market not found.
- **401**: Not authenticated. Send a valid JWT (cookie/Authorization/query) or API key.
- **403**: User not registered (JWT valid but user not in DB). Complete registration before placing orders.
- **500**: Order processing failed. Response includes `error` and `message`.

**Persistence**

- Every processed order is written to the database (Order table: id, marketId, outcomeIndex, side, amount, price, status, createdAt, updatedAt).
- When an order matches, resulting trades are enqueued and persisted (Trade table: id, marketId, outcomeIndex, side, amount, price, etc.). The same worker creates or updates **Position** records for buyer (LONG +qty) and seller (LONG -qty or SHORT +qty) for that outcome, using the market's `outcomePositionIds` (CTF position id per outcome) when available. Market volume is updated accordingly.

---

## Trades

### How trades are created and stored

- Trades are produced by the matching engine when a BID matches an ASK (or vice versa). Each fill is one trade record.
- Executed trades are enqueued for persistence and written to the database asynchronously (Trade table: id, marketId, userId, agentId, side, amount, price, txHash, createdAt).
- After persistence, market volume is updated and a market-stats update can be broadcast (e.g. over WebSocket).

### Getting trade data (frontend)

There is no dedicated REST endpoint such as `GET /api/trades` or `GET /api/markets/:id/trades` in the current API. Trade-related data is available as follows.

**1. Market list and market by id**

- **GET /api/markets** and **GET /api/markets/:id** include trade-derived stats per market:
  - **totalTrades**: Count of trades for that market.
  - **lastTradeAt**: ISO 8601 timestamp of the most recent trade (or `null`).
  - **totalVolume**: Sum of (amount × price) over all trades (also exposed as `volume` / `totalVolume` in the market payload).

Use these for tables and market detail pages (e.g. "Last trade", "Total trades", "Volume").

**2. Real-time: WebSocket TRADE_EXECUTED**

Subscribe to the room for a market (e.g. `market:<marketId>`) and listen for `TRADE_EXECUTED` events. Each event corresponds to one executed trade.

**Event name:** `TRADE_EXECUTED`

**Payload (TradeExecutedPayload)**

| Field       | Type   | Description |
|-------------|--------|-------------|
| marketId    | string | Market UUID. |
| side        | string | `"long"` (BID) or `"short"` (ASK). |
| size        | string | Trade quantity. |
| price       | string | Execution price. |
| executedAt  | string | ISO 8601 timestamp. |
| userId      | string | Optional user UUID. |
| agentId     | string | Optional agent UUID. |

Example:

```json
{
  "type": "TRADE_EXECUTED",
  "payload": {
    "marketId": "550e8400-e29b-41d4-a716-446655440000",
    "side": "long",
    "size": "50.000000000000000000",
    "price": "0.45",
    "executedAt": "2025-02-20T14:30:00.123Z",
    "userId": null,
    "agentId": null
  }
}
```

Use this to update the UI in real time (e.g. trade feed, last price, volume).

**3. Order response**

The response of `POST /api/orders` includes an immediate list of trades that executed for that order. Use it to show the user what filled right away without polling or waiting for WebSocket.

---

## Summary for frontend integration

| Need                         | Use |
|-----------------------------|-----|
| Submit buy/sell order       | `POST /api/orders` with user JWT (cookie/Bearer) or API key; handle 201 (orderId + trades + snapshot) and 4xx/5xx. |
| Order book after order      | Use `snapshot` in the same 201 response. |
| Historical trade count/volume per market | `GET /api/markets` or `GET /api/markets/:id`: `totalTrades`, `lastTradeAt`, `totalVolume`. |
| Real-time trade events      | WebSocket: subscribe to `market:<marketId>`, handle `TRADE_EXECUTED`. |
| List all orders or trades by market | Not provided by current REST API; orders and trades are stored in the DB for future endpoints or internal use. |

---

## Related

- **Markets API**: `md/markets.api.md` (list/detail, stats, create/update/delete).
- **WebSocket**: `md/websocket-integration.frontend.md` (subscribe, events, PING/PONG).
