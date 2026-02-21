# Activities, Holders and Traders API

Reference for the activities feed and market-level holders and traders endpoints.

---

## Overview

- **Activities**: A unified feed of events (trades, positions, news, agent activities) that can be filtered by market, user, agent, or position. Use for activity feeds, history, and dashboards.
- **Holders**: Users or agents who hold positions in a market (with position counts).
- **Traders**: Users or agents who have traded in a market (with trade count and volume).

---

## Activities

### Get activities

**`GET /api/activities`**

Returns a paginated list of activity items, sorted by `createdAt` descending. Each item has a `type` and a `payload` whose shape depends on the type.

**Query parameters**

| Parameter   | Type   | Required | Description |
|------------|--------|----------|-------------|
| marketId   | string | No       | UUID of the market. Restricts activities to this market. |
| userId     | string | No       | UUID of the user. Restricts to activities for this user (trades, positions). |
| agentId    | string | No       | UUID of the agent. Restricts to activities for this agent. |
| positionId | string | No       | UUID of the position. Restricts to the single position (position-type only). |
| types      | string | No       | Comma-separated activity types: `trade`, `position`, `news`, `agent_activity`. Default: all. |
| limit      | number | No       | Page size (1–100). Default: 20. |
| offset     | number | No       | Number of items to skip. Default: 0. |

**Response (200)**

```json
{
  "data": [
    {
      "id": "uuid",
      "type": "trade",
      "createdAt": "2025-02-20T14:30:00.000Z",
      "payload": {
        "type": "trade",
        "id": "uuid",
        "marketId": "uuid",
        "userId": "uuid-or-null",
        "agentId": "uuid-or-null",
        "side": "BID",
        "amount": "100.000000000000000000",
        "price": "0.45",
        "txHash": null,
        "createdAt": "2025-02-20T14:30:00.000Z"
      }
    },
    {
      "id": "uuid",
      "type": "news",
      "createdAt": "2025-02-20T12:00:00.000Z",
      "payload": {
        "type": "news",
        "id": "uuid",
        "marketId": "uuid",
        "title": "Headline",
        "body": "Summary.",
        "imageUrl": null,
        "sourceUrl": "https://...",
        "createdAt": "2025-02-20T12:00:00.000Z"
      }
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

**Activity payload types**

- **trade**: `id`, `marketId`, `userId`, `agentId`, `side`, `amount`, `price`, `txHash`, `createdAt`.
- **position**: `id`, `marketId`, `userId`, `agentId`, `address`, `side`, `status`, `avgPrice`, `collateralLocked`, `createdAt`, `updatedAt`.
- **news**: `id`, `marketId`, `title`, `body`, `imageUrl`, `sourceUrl`, `createdAt`.
- **agent_activity**: `id`, `agentId`, `activityType`, `payload` (opaque), `createdAt`.

**Use cases**

- Activities for a **market**: `GET /api/activities?marketId=<id>` (trades, positions, news for that market).
- Activities for a **holder** or **trader**: `GET /api/activities?userId=<id>` or `?agentId=<id>`.
- Activities for a **position**: `GET /api/activities?positionId=<id>` (returns the position event).
- Only **trades** and **news**: `GET /api/activities?types=trade,news`.

**Errors**

- **400**: Invalid query (e.g. invalid UUID). Response includes `error` and `details`.

---

## Holders

### Get market holders

**`GET /api/markets/:id/holders`**

Returns a list of holders (users/agents/addresses) that have or had positions in the given market. Each holder is summarized with position counts.

**Parameters**

- **id**: Market UUID (path).

**Response (200)**

```json
{
  "data": [
    {
      "userId": "uuid-or-null",
      "agentId": "uuid-or-null",
      "address": "0x...",
      "positionCount": 3,
      "openPositionCount": 2
    }
  ]
}
```

- **userId** / **agentId**: Present when the position is attributed to a user or agent.
- **address**: Wallet address for the position.
- **positionCount**: Total positions for this holder in this market.
- **openPositionCount**: Count of positions with status OPEN.

**Errors**

- **404**: Market not found.

---

## Traders

### Get market traders

**`GET /api/markets/:id/traders`**

Returns a list of traders (users/agents) that have traded in the given market, with trade count and total volume.

**Parameters**

- **id**: Market UUID (path).

**Response (200)**

```json
{
  "data": [
    {
      "userId": "uuid-or-null",
      "agentId": "uuid-or-null",
      "tradeCount": 15,
      "totalVolume": "1250.500000000000000000"
    }
  ]
}
```

- **userId** / **agentId**: One or both may be set per trade; each row is a distinct (userId, agentId) pair.
- **tradeCount**: Number of trades for this trader in this market.
- **totalVolume**: Sum of (amount × price) for those trades.

**Errors**

- **404**: Market not found.

---

## Summary

| Need | Endpoint |
|------|----------|
| Activity feed for a market | `GET /api/activities?marketId=<id>` |
| Activity feed for a user/holder/trader | `GET /api/activities?userId=<id>` or `?agentId=<id>` |
| Activity feed for a position | `GET /api/activities?positionId=<id>` |
| Only certain event types | `GET /api/activities?types=trade,news` |
| List holders in a market | `GET /api/markets/:id/holders` |
| List traders in a market | `GET /api/markets/:id/traders` |

All endpoints are public (no authentication required for reading).
