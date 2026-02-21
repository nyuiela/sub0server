# Markets API Reference

Detailed reference for `/api/markets` for frontend use: listing, filtering, fetching by id or condition, creating, updating, and deleting markets.

---

## Base path

All endpoints are under **`/api/markets`**.

---

## 1. List markets

**`GET /api/markets`**

Returns a paginated list of markets, ordered by creation date (newest first). Public; no authentication required.

### Query parameters

| Parameter        | Type   | Required | Default | Description |
|------------------|--------|----------|---------|-------------|
| `status`         | string | No       | -       | Filter by status. One of: `OPEN`, `RESOLVING`, `CLOSED`, `DISPUTED`. |
| `creatorAddress` | string | No       | -       | Filter by creator wallet address (case-sensitive). |
| `platform`       | string | No       | -       | Filter by platform. One of: `NATIVE`, `POLYMARKET`, `KALSHI`, `MANIFOLD`, `OTHER`. |
| `limit`          | number | No       | 20      | Page size. Min 1, max 100. Coerced from string (e.g. `?limit=10`). |
| `offset`         | number | No       | 0       | Number of records to skip. Coerced from string. |

### Example requests

```http
GET /api/markets
GET /api/markets?status=OPEN
GET /api/markets?creatorAddress=0x1234...&limit=10&offset=0
```

### Response (200)

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Will X happen by date Y?",
      "creatorAddress": "0x...",
      "volume": "0",
      "context": "Optional description or context.",
      "imageUrl": null,
      "outcomes": ["Yes", "No"],
      "sourceUrl": "https://...",
      "resolutionDate": "2025-12-31T23:59:59.000Z",
      "oracleAddress": "0x...",
      "status": "OPEN",
      "collateralToken": "0x...",
      "conditionId": "0x...",
      "platform": "NATIVE",
      "liquidity": null,
      "confidence": null,
      "pnl": null,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z",
      "totalVolume": "0",
      "uniqueStakersCount": 0,
      "lastTradeAt": null,
      "totalTrades": 0,
      "activeOrderCount": 0,
      "orderBookBidLiquidity": "0",
      "orderBookAskLiquidity": "0",
      "agentsEngagingCount": 0,
      "newsCount": 0
    }
  ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

- **`data`**: Array of market objects with base fields plus aggregated stats (see Market object shape).
- **`totalVolume`**: Sum of (amount * price) across all trades for this market (string).
- **`uniqueStakersCount`**: Count of distinct addresses with positions in this market.
- **`lastTradeAt`**: ISO 8601 datetime of the most recent trade, or null.
- **`totalTrades`**: Count of trades for this market.
- **`activeOrderCount`**: Number of resting orders in the in-memory order book.
- **`orderBookBidLiquidity`**, **`orderBookAskLiquidity`**: Sum of (price * quantity) on bid/ask side (string).
- **`agentsEngagingCount`**: Count of distinct agents with positions in this market.
- **`newsCount`**: Count of news items linked to this market.
- **`platform`**: One of `NATIVE`, `POLYMARKET`, `KALSHI`, `MANIFOLD`, `OTHER`.
- **`total`**: Total count of markets matching the filter (before pagination).
- **`limit`**, **`offset`**: Echo of the query params used (or defaults).

### Validation errors (400)

If query params are invalid (e.g. invalid `status`, `limit` &gt; 100):

```json
{
  "error": "Invalid query",
  "details": { "fieldErrors": { ... }, "formErrors": [] }
}
```

---

## 2. Get market by id

**`GET /api/markets/:id`**

Returns a single market by its UUID, with a small sample of related positions and orders. Public.

### Path parameters

| Parameter | Type   | Description |
|-----------|--------|-------------|
| `id`      | string | Market UUID. |

### Example

```http
GET /api/markets/550e8400-e29b-41d4-a716-446655440000
```

### Response (200)

Same market shape as in the list (including all stats), plus:

- **`positionIds`**: Array of contract position IDs (from smart contract) for positions in this market.
- **`orderBookSnapshot`**: Full order book snapshot (bids/asks with price, quantity, orderCount; marketId; timestamp).
- **`positions`**: Up to 10 positions for this market (full position objects).
- **`orders`**: Up to 5 orders for this market (order id, marketId, side, amount, price, status, createdAt, updatedAt).

```json
{
  "id": "uuid",
  "name": "...",
  "creatorAddress": "0x...",
  "volume": "0",
  "context": null,
  "imageUrl": null,
  "outcomes": ["Yes", "No"],
  "sourceUrl": null,
  "resolutionDate": "2025-12-31T23:59:59.000Z",
  "oracleAddress": "0x...",
  "status": "OPEN",
  "collateralToken": "0x...",
  "conditionId": "0x...",
  "platform": "NATIVE",
  "liquidity": null,
  "confidence": null,
  "pnl": null,
  "createdAt": "...",
  "updatedAt": "...",
  "totalVolume": "0",
  "uniqueStakersCount": 0,
  "lastTradeAt": null,
  "totalTrades": 0,
  "activeOrderCount": 0,
  "orderBookBidLiquidity": "0",
  "orderBookAskLiquidity": "0",
  "agentsEngagingCount": 0,
  "positionIds": ["token-id-1", "token-id-2"],
  "newsCount": 0,
  "orderBookSnapshot": { "marketId": "uuid", "bids": [], "asks": [], "timestamp": 1234567890 },
  "positions": [ ... ],
  "orders": [ ... ]
}
```

### Response (404)

```json
{
  "error": "Market not found"
}
```

---

## 3. Get market by condition id

**`GET /api/markets/condition/:conditionId`**

Returns a single market by its unique `conditionId` (e.g. on-chain condition id), with the same aggregated stats as the list endpoint (totalVolume, uniqueStakersCount, lastTradeAt, totalTrades, activeOrderCount, orderBookBidLiquidity, orderBookAskLiquidity, agentsEngagingCount, newsCount). Public.

### Path parameters

| Parameter     | Type   | Description |
|---------------|--------|-------------|
| `conditionId` | string | Unique condition identifier. |

### Example

```http
GET /api/markets/condition/0xabc123...
```

### Response (200)

Same market shape as in the list (no `positions` or `orders`).

### Response (404)

```json
{
  "error": "Market not found"
}
```

---

## 4. Create market

**`POST /api/markets`**

Creates a new market. Requires authentication (JWT or API key). If using JWT, `creatorAddress` must match the authenticated wallet address.

### Request body

| Field             | Type     | Required | Description |
|-------------------|----------|----------|-------------|
| `name`            | string   | Yes      | Market name (non-empty). |
| `creatorAddress`  | string   | Yes      | Creator wallet address. Must match JWT wallet if using user auth. |
| `context`         | string   | No       | Optional description or context. |
| `outcomes`        | array    | Yes      | Array of outcome labels, e.g. `["Yes", "No"]`. Elements can be any JSON. |
| `sourceUrl`       | string   | No       | Must be a valid URL if provided. |
| `resolutionDate`  | string   | Yes      | ISO 8601 datetime, e.g. `2025-12-31T23:59:59.000Z`. |
| `oracleAddress`   | string   | Yes      | Oracle contract or authority address. |
| `collateralToken` | string   | Yes      | Collateral token address. |
| `conditionId`     | string   | Yes      | Unique condition id. Must not already exist. |
| `platform`        | string   | No       | One of: `NATIVE`, `POLYMARKET`, `KALSHI`, `MANIFOLD`, `OTHER`. Default: `NATIVE`. |

### Example

```json
{
  "name": "Will it rain tomorrow?",
  "creatorAddress": "0x1234...",
  "context": "City of X",
  "outcomes": ["Yes", "No"],
  "sourceUrl": "https://example.com/event",
  "resolutionDate": "2025-12-31T23:59:59.000Z",
  "oracleAddress": "0x...",
  "collateralToken": "0xUSDC...",
  "conditionId": "0xcondition..."
}
```

### Response (201)

Single market object (same shape as list), with generated `id`, `createdAt`, `updatedAt`, and default `volume: "0"`, `status: "OPEN"`.

### Error responses

- **400** – Validation failed (e.g. missing required fields, invalid URL or datetime):

  ```json
  {
    "error": "Validation failed",
    "details": { "fieldErrors": { ... }, "formErrors": [] }
  }
  ```

- **401** – Not authenticated (no valid JWT or API key).

- **403** – Forbidden when using JWT: `creatorAddress` does not match authenticated wallet:

  ```json
  {
    "error": "Forbidden: creatorAddress must match your wallet"
  }
  ```

- **409** – A market with this `conditionId` already exists:

  ```json
  {
    "error": "Market with this conditionId already exists"
  }
  ```

---

## 5. Update market

**`PATCH /api/markets/:id`**

Updates an existing market. Allowed only for the market creator (wallet match) or API key.

### Path parameters

| Parameter | Type   | Description |
|-----------|--------|-------------|
| `id`      | string | Market UUID. |

### Request body (all fields optional)

| Field            | Type   | Description |
|------------------|--------|-------------|
| `name`           | string | Market name (non-empty). |
| `context`        | string | Optional description. |
| `outcomes`       | array  | Outcome labels. |
| `sourceUrl`      | string | Valid URL or null. |
| `resolutionDate`  | string | ISO 8601 datetime. |
| `oracleAddress`  | string | Oracle address. |
| `status`         | string | One of: `OPEN`, `RESOLVING`, `CLOSED`, `DISPUTED`. |
| `platform`       | string | One of: `NATIVE`, `POLYMARKET`, `KALSHI`, `MANIFOLD`, `OTHER`. |
| `liquidity`      | number | Stored liquidity (e.g. from AMM/chain). Null to clear. |
| `confidence`     | number | Confidence score 0–1. Null to clear. |
| `pnl`            | number | Market-level PnL. Null to clear. |

### Example

```json
{
  "status": "CLOSED",
  "context": "Resolved on 2025-01-15",
  "platform": "NATIVE"
}
```

### Response (200)

Updated market object (same shape as list).

### Error responses

- **400** – Validation failed.
- **401** – Not authenticated.
- **403** – Not the market creator and not API key.
- **404** – Market not found.

---

## 6. Delete market

**`DELETE /api/markets/:id`**

Deletes a market. Allowed only for the market creator or API key. Related data (positions, orders, trades, etc.) is handled by the database (e.g. cascade).

### Path parameters

| Parameter | Type   | Description |
|-----------|--------|-------------|
| `id`      | string | Market UUID. |

### Response (204)

No body.

### Error responses

- **401** – Not authenticated.
- **403** – Not the market creator and not API key.
- **404** – Market not found (or already deleted).

---

## 7. Market object shape (summary)

| Field                     | Type           | Notes |
|---------------------------|----------------|--------|
| `id`                      | string         | UUID. |
| `name`                    | string         | |
| `creatorAddress`          | string         | Wallet address. |
| `volume`                  | string         | Stored volume (decimal as string). |
| `context`                  | string \| null | |
| `imageUrl`                | string \| null | Present in response; not settable in create/update in current API. |
| `outcomes`                | array          | JSON array (e.g. `["Yes", "No"]`). |
| `sourceUrl`               | string \| null | |
| `resolutionDate`          | string         | ISO 8601 datetime. |
| `oracleAddress`           | string         | |
| `status`                  | string         | `OPEN` \| `RESOLVING` \| `CLOSED` \| `DISPUTED`. |
| `collateralToken`         | string         | |
| `conditionId`             | string         | Unique. |
| `platform`                | string         | `NATIVE` \| `POLYMARKET` \| `KALSHI` \| `MANIFOLD` \| `OTHER`. |
| `liquidity`               | string \| null | Stored liquidity (decimal as string). |
| `confidence`              | number \| null | 0–1. |
| `pnl`                     | string \| null | Market-level PnL (decimal as string). |
| `createdAt`               | string         | ISO 8601. |
| `updatedAt`                | string         | ISO 8601. |
| `totalVolume`             | string         | Sum of trade amount*price (list/detail). |
| `uniqueStakersCount`      | number         | Distinct addresses with positions. |
| `lastTradeAt`             | string \| null | ISO 8601 of last trade. |
| `totalTrades`              | number         | Trade count. |
| `activeOrderCount`        | number         | Resting orders in order book. |
| `orderBookBidLiquidity`   | string         | Bid-side depth (list/detail). |
| `orderBookAskLiquidity`   | string         | Ask-side depth (list/detail). |
| `agentsEngagingCount`     | number         | Distinct agents with positions. |
| `positionIds`             | string[]       | Contract position IDs (detail only). |
| `newsCount`                | number         | News items for this market. |
| `orderBookSnapshot`        | object \| null | Full book snapshot (detail only). |

---

## 8. Frontend usage notes

1. **Listing**: Use `GET /api/markets` with `status=OPEN` for open markets, and optional `creatorAddress` for “my markets”. Use `limit` and `offset` for pagination; `total` supports “Page X of Y” or infinite scroll.
2. **Detail**: Use `GET /api/markets/:id` when you have the UUID and need a few positions/orders; use `GET /api/markets/condition/:conditionId` when you only have the condition id (e.g. from chain).
3. **Create**: Send JWT (cookie or Bearer). Set `creatorAddress` to the connected wallet. Ensure `conditionId` is unique (e.g. from your condition factory).
4. **Update/delete**: Same auth as create; only creator or API key can PATCH/DELETE. Use for closing/resolving or removing markets.
5. **Errors**: Handle 400 (validation), 401 (re-auth), 403 (not allowed), 404 (not found), 409 (duplicate conditionId on create).

6. **Position IDs**: To have contract position IDs appear in `positionIds` on market detail, set `contractPositionId` when creating or updating positions (via `/api/positions`) from your smart contract data.

7. **Platform**: Use `platform` when creating markets (e.g. `NATIVE` for in-app, `POLYMARKET` for imported) and filter lists with `?platform=NATIVE`.
