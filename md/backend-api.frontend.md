# Backend API Report for Frontend

Overview of the Sub0 backend: REST API, authentication, order book, LMSR, markets, and WebSocket. Use this for frontend integration.

---

## 1. Authentication

- **Methods**: (1) Thirdweb JWT (wallet sign-in), (2) API key (server/admin).
- **JWT**: Sent via cookie `sub0-auth-jwt` (configurable), or header `Authorization: Bearer <token>`, or query `?token=`. Backend verifies with Thirdweb; `AUTH_DOMAIN` must match the frontend domain.
- **API key**: Header `x-api-key` or `api-key`. Bypasses JWT; used for admin/server access.
- **Identity**: Resolved user has `address` (wallet) and `userId` (Prisma User id) when registered. Unregistered wallet has `address` only (e.g. register flow).

---

## 2. REST API Summary

Base URL: same origin or configured backend. All mutation routes require auth unless noted.

| Resource   | GET | POST | PATCH | DELETE | Permission notes |
|-----------|-----|------|-------|--------|-------------------|
| Users     | List, by id, by address (public) | Create (auth) | Own user or API key | Own user or API key | |
| Agents    | List, by id (public) | Create (user: own ownerId only; or API key) | Owner or API key | Owner or API key | |
| Markets   | List, by id, by conditionId (public) | Create (user: creatorAddress = wallet; or API key) | Creator or API key | Creator or API key | |
| Positions | List, by id (public) | Create (auth) | Owner or API key | Owner or API key | Owner = userId or agent owner |
| Tools     | List, by id (public) | API key only | API key only | API key only | |
| Strategies | Get by agentId (public) | Agent owner or API key | Agent owner or API key | Agent owner or API key | |
| Register  | Username available (public) | User only (JWT) | - | - | Creates User + Agent; keys generated server-side |
| Agent enqueue | - | Agent owner or API key | - | - | Enqueues prediction job for agent+market |

---

## 3. CRUD and Permissions Detail

### Users (`/api/users`)

- **GET** `/api/users` – List (query: `limit`, `offset`). Public.
- **GET** `/api/users/:id` – By id. Public.
- **GET** `/api/users/address/:address` – By wallet address. Public.
- **POST** `/api/users` – Create. Requires JWT or API key.
- **PATCH** `/api/users/:id` – Update. Allowed only for the user whose id is `:id`, or API key.
- **DELETE** `/api/users/:id` – Delete. Same as PATCH (own user or API key).

### Agents (`/api/agents`)

- **GET** `/api/agents` – List (query: `ownerId`, `status`, `limit`, `offset`). Public.
- **GET** `/api/agents/:id` – By id. Public.
- **POST** `/api/agents` – Create. JWT or API key. If JWT, `body.ownerId` must equal authenticated user id.
- **PATCH** `/api/agents/:id` – Update. Agent owner or API key.
- **DELETE** `/api/agents/:id` – Delete. Agent owner or API key.

### Markets (`/api/markets`)

- **GET** `/api/markets` – List (query: `status`, `creatorAddress`, `limit`, `offset`). Public.
- **GET** `/api/markets/:id` – By id. Public.
- **GET** `/api/markets/condition/:conditionId` – By condition id. Public.
- **POST** `/api/markets` – Create. JWT or API key. If JWT, `body.creatorAddress` must match wallet.
- **PATCH** `/api/markets/:id` – Update. Market creator (by wallet) or API key.
- **DELETE** `/api/markets/:id` – Delete. Market creator or API key.

### Positions (`/api/positions`)

- **GET** `/api/positions` – List (query: `marketId`, `userId`, `agentId`, `address`, `status`, `limit`, `offset`). Public.
- **GET** `/api/positions/:id` – By id. Public.
- **POST** `/api/positions` – Create. JWT or API key.
- **PATCH** `/api/positions/:id` – Update. Position owner (user or agent owner) or API key.
- **DELETE** `/api/positions/:id` – Delete. Same as PATCH.

### Tools (`/api/tools`)

- **GET** `/api/tools` – List (query: `provider`, `limit`, `offset`). Public.
- **GET** `/api/tools/:id` – By id. Public.
- **POST** `/api/tools` – Create. API key only.
- **PATCH** `/api/tools/:id` – Update. API key only.
- **DELETE** `/api/tools/:id` – Delete. API key only.

### Strategies (`/api/strategies`)

- **GET** `/api/strategies/agent/:agentId` – Strategy for agent. Public.
- **POST** `/api/strategies` – Create. Owner of `body.agentId` or API key.
- **PATCH** `/api/strategies/agent/:agentId` – Update. Agent owner or API key.
- **DELETE** `/api/strategies/agent/:agentId` – Delete. Agent owner or API key.

### Register (`/api/register`)

- **GET** `/api/register/username/available?username=` – Check availability. Public.
- **POST** `/api/register` – Register user + agent. JWT required. Body: `username`, `authMethod`, `agent: { create: { name, persona?, modelSettings? } }` or `agent: { template: { templateId, name, persona?, modelSettings? } }`. Agent keys are generated server-side; do not send `publicKey` or `encryptedPrivateKey`.

### Agent enqueue (`/api/agent/enqueue`)

- **POST** – Body: `{ marketId, agentId }`. Owner of the agent or API key.

---

## 4. Order Book (Matching Engine)

- **Model**: Price-time priority. Bids: price desc, time asc. Asks: price asc, time asc.
- **Order types**: LIMIT (rest in book), MARKET (fill at best, no rest), IOC (fill what’s available, cancel rest).
- **Concurrency**: One order processed at a time per market; queue is per `marketId`.
- **Usage**: Frontend does not call HTTP order endpoints by default. Orders are submitted via the backend module `submitOrder(orderInput)` (see `src/engine/order-queue.ts`). To expose to the frontend, add e.g. `POST /api/orders` that accepts an order payload and calls `submitOrder`, with auth (user or API key).
- **Order input**: `{ id, marketId, side: "BID"|"ASK", type: "LIMIT"|"MARKET"|"IOC", price? (required for LIMIT), quantity, userId?, agentId? }`. Quantities and prices as strings or numbers; engine uses decimal.js.
- **Response**: `submitOrder` returns `Promise<{ trades, snapshot }>`. Trades are published to Redis (`TRADES`, `ORDER_BOOK_UPDATE`) and enqueued for DB persistence.

---

## 5. WebSocket

- **Endpoint**: `GET /ws` (upgrade to WebSocket).
- **Auth**: Optional; request auth is resolved (cookie/header) and attached for room filtering if needed.
- **Subscribe**: Send `{ type: "SUBSCRIBE", payload: { room: "market:<marketId>" } }` to receive order book and trade updates for that market.
- **Events from server**:
  - `ORDER_BOOK_UPDATE`: `{ marketId, bids, asks, timestamp }`. Bids/asks are `{ price, quantity, orderCount? }[]`.
  - `TRADE_EXECUTED`: `{ marketId, side: "long"|"short", size, price, executedAt, userId?, agentId? }`.
  - `PRICE_UPDATE`: External price feed (e.g. symbol, price, source).
  - `PING` / `PONG`: Keepalive.
  - `ERROR`: `{ code, message }`.
- **Rooms**: Use room `market:<marketId>` for order book and trades. Other rooms may be used for price feed by symbol.

---

## 6. LMSR (Prediction Market Pricing)

- **Role**: Off-chain pricing for AMM-style prediction markets. Cost and prices are computed in the backend; settlement can be on-chain (e.g. PredictionVault + EIP-712).
- **Functions** (from `src/engine/lmsr-engine.ts`):
  - `calculateCost(q, b)` – Cost C(q) = b·ln(∑ exp(q_i/b)).
  - `getInstantPrice(q, b, targetOutcome)` – Marginal price for one outcome (0–1).
  - `getAllPrices(q, b)` – Prices for all outcomes (sum to 1).
  - `getQuoteForBuy(q, b, outcomeIndex, quantity)` – Returns `{ instantPrice, tradeCost, qAfter }`.
  - `getQuoteForSell(q, b, outcomeIndex, quantity)` – Same for selling.
  - `worstCaseLoss(b, numOutcomes)` – Upper bound b·ln(n).
- **EIP-712**: Backend can sign quotes (see `src/lib/eip712-quote.ts`). Contract verifies signature and escrows USDC / mints outcome tokens. No REST endpoint is defined by default; frontend can call a backend “quote” endpoint that returns a signed quote for a given market/outcome/side/quantity.

---

## 7. Markets (Data Model)

- **Fields**: id, name, creatorAddress, volume, context, imageUrl, outcomes (JSON), sourceUrl, resolutionDate, oracleAddress, status, collateralToken, conditionId.
- **Outcomes**: JSON array (e.g. `["Yes","No"]`). Used by LMSR as number of outcomes.
- **List**: Use query params to filter by status and creator. Responses include serialized volume (string).

---

## 8. Health and Config

- **GET** `/health` – Returns `{ status: "ok" }`. No auth.
- **CORS**: Configured via `CORS_ORIGIN`; credentials allowed for cookie auth.

---

## 9. Frontend Checklist

1. **Auth**: Send JWT in cookie `sub0-auth-jwt` or `Authorization: Bearer <token>` for user-scoped routes.
2. **Register**: After wallet sign-in, call `POST /api/register` with JWT and body (username, authMethod, agent.create or agent.template). Do not send agent keys.
3. **Permissions**: 401 = not authenticated; 403 = forbidden (wrong user/owner/creator or missing API key where required).
4. **Order book**: Subscribe to `market:<marketId>` on WebSocket for ORDER_BOOK_UPDATE and TRADE_EXECUTED. If you add `POST /api/orders`, send order payload and handle returned trades/snapshot.
5. **LMSR**: Use backend quote endpoints (if added) for buy/sell quotes and signed EIP-712 payload for on-chain execution.
6. **Tools**: Create/update/delete only with API key (admin).
