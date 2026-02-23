# Positions API Reference

Reference for frontend integration: listing, fetching, creating, and updating position records. Positions represent a user's or agent's exposure (LONG or SHORT) in a market outcome.

---

## Overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/positions | Optional | List positions with filters and pagination |
| GET | /api/positions/:id | None | Get one position by id |
| POST | /api/positions | User or API key | Create a position |
| PATCH | /api/positions/:id | Owner or API key | Update a position |
| DELETE | /api/positions/:id | Owner or API key | Delete a position |

**Position fields:** `id`, `marketId`, `userId`, `agentId`, `address`, `tokenAddress`, `outcomeIndex`, `side` (LONG | SHORT), `status` (OPEN | CLOSED | LIQUIDATED), `avgPrice`, `collateralLocked`, `isAmm`, `contractPositionId`, `createdAt`, `updatedAt`. Numeric amounts are returned as strings to avoid precision loss.

---

## List positions

**GET /api/positions**

Returns a paginated list of positions, newest first. Optional query filters narrow results.

**Authentication:** Optional. Without auth you can still list; with user JWT or API key the server can enforce owner-based filtering if needed.

**Query parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| marketId | string (UUID) | No | Filter by market |
| userId | string (UUID) | No | Filter by user |
| agentId | string (UUID) | No | Filter by agent |
| address | string | No | Filter by wallet address |
| status | string | No | One of: OPEN, CLOSED, LIQUIDATED |
| limit | number | No | Page size (1–100). Default 20 |
| offset | number | No | Skip count. Default 0 |

**Example request**

```
GET /api/positions?marketId=550e8400-e29b-41d4-a716-446655440000&status=OPEN&limit=10&offset=0
```

**Response (200)**

```json
{
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "marketId": "550e8400-e29b-41d4-a716-446655440000",
      "userId": null,
      "agentId": "agent-uuid-here",
      "address": "0x1234...",
      "tokenAddress": "0xToken...",
      "outcomeIndex": 0,
      "side": "LONG",
      "status": "OPEN",
      "avgPrice": "0.450000000000000000",
      "collateralLocked": "100.000000000000000000",
      "isAmm": false,
      "contractPositionId": null,
      "createdAt": "2025-02-20T12:00:00.000Z",
      "updatedAt": "2025-02-20T12:00:00.000Z",
      "market": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "name": "Will X happen?",
        "conditionId": "0x..."
      }
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

**List item shape**

- All position fields above (with `avgPrice` and `collateralLocked` as strings).
- **market:** `{ id, name, conditionId }`.

**Errors**

- **400:** Invalid query (e.g. invalid UUID or status). Response includes `error` and `details`.

---

## Get one position

**GET /api/positions/:id**

Returns a single position by id with full market and optional user/agent info.

**Authentication:** None required.

**Response (200)**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "marketId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-uuid",
  "agentId": null,
  "address": "0x1234...",
  "tokenAddress": "0xToken...",
  "outcomeIndex": 0,
  "side": "LONG",
  "status": "OPEN",
  "avgPrice": "0.450000000000000000",
  "collateralLocked": "100.000000000000000000",
  "isAmm": false,
  "contractPositionId": null,
  "createdAt": "2025-02-20T12:00:00.000Z",
  "updatedAt": "2025-02-20T12:00:00.000Z",
  "market": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Will X happen?",
    "creatorAddress": "0x...",
    "volume": "1000",
    "context": null,
    "outcomes": ["Yes", "No"],
    "resolutionDate": "2025-12-31T00:00:00.000Z",
    "oracleAddress": "0x...",
    "status": "OPEN",
    "collateralToken": "0x...",
    "conditionId": "0x...",
    "platform": "NATIVE",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "user": {
    "id": "user-uuid",
    "address": "0x1234..."
  },
  "agent": null
}
```

- **market:** Full market object (all scalar fields returned by Prisma).
- **user:** `{ id, address }` or null if position is agent-only.
- **agent:** `{ id, name }` or null if position is user-only.

**Errors**

- **404:** Position not found. Response: `{ "error": "Position not found" }`.

---

## Create position

**POST /api/positions**

Creates a new position. Used when opening or syncing positions (e.g. from chain or after trades).

**Authentication:** Required. User JWT (cookie or Authorization) or API key.

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| marketId | string (UUID) | Yes | Market id |
| userId | string (UUID) | No | User id (optional if agentId set) |
| agentId | string (UUID) | No | Agent id (optional if userId set) |
| address | string | Yes | Wallet address for this position |
| tokenAddress | string | Yes | Collateral/token contract address |
| outcomeIndex | number (int ≥ 0) | Yes | Outcome index (e.g. 0 = Yes, 1 = No) |
| side | string | Yes | LONG or SHORT |
| avgPrice | string | Yes | Average entry price (decimal string) |
| collateralLocked | string | Yes | Size/collateral (decimal string) |
| isAmm | boolean | No | Default false |
| contractPositionId | string | No | On-chain position/token id |

**Example request**

```json
{
  "marketId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-uuid",
  "address": "0x1234...",
  "tokenAddress": "0xCollateral...",
  "outcomeIndex": 0,
  "side": "LONG",
  "avgPrice": "0.45",
  "collateralLocked": "100"
}
```

**Response (201)**

Same shape as a list item: position fields (with `avgPrice`, `collateralLocked` as strings) plus `market: { id, name }`.

**Errors**

- **400:** Validation failed. Response includes `error` and `details`.
- **404:** Market not found, or user/agent not found when provided.
- **401:** Not authenticated.
- **403:** Forbidden (e.g. user not allowed to create for that owner).

---

## Update position

**PATCH /api/positions/:id**

Updates a position. Only the position owner (by address) or API key can update.

**Authentication:** Required. Owner or API key (see requirePositionOwnerOrApiKey).

**Request body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | OPEN, CLOSED, or LIQUIDATED |
| contractPositionId | string | No | On-chain position/token id |

All fields are optional; only provided fields are updated.

**Response (200)**

Position object (serialized) plus `market: { id, name }`. Same numeric string behavior as list.

**Errors**

- **400:** Validation failed.
- **404:** Position not found.
- **401:** Not authenticated.
- **403:** Not the position owner.

---

## Delete position

**DELETE /api/positions/:id**

Deletes a position. Only the position owner or API key can delete. The server broadcasts a market update for the position’s market after delete.

**Authentication:** Required. Owner or API key.

**Response (204)**

No body.

**Errors**

- **401:** Not authenticated.
- **403:** Not the position owner.
- **404:** Position not found (or already deleted).

---

## Frontend usage notes

1. **Listing:** Use `GET /api/positions` with `marketId` to show positions per market, or `userId` / `agentId` / `address` for portfolios. Use `limit` and `offset` for pagination; `total` is the total count for the current filters.
2. **Numbers:** Treat `avgPrice` and `collateralLocked` as decimal strings (e.g. use a decimal library or parse to number only when display precision is fixed).
3. **Relations:** List responses include `market: { id, name, conditionId }`. Detail includes full `market` plus `user` and `agent` when present.
4. **Status:** Use `status=OPEN` in the list query to show only open positions; use CLOSED or LIQUIDATED for history or settled views.
5. **Auth:** Create/update/delete require auth; list and get-one can be called without auth for public or read-only UIs.
