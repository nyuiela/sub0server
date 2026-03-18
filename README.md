## Sub0 Backend (sub0server)

Sub0 backend is the core API, matching engine, and orchestration layer for the Sub0 prediction market platform. It exposes REST and WebSocket interfaces for the frontend and SDKs, manages Postgres and Redis state, talks to Chainlink CRE for on‑chain actions, and drives the AI agent worker and simulate sandbox.

---

## 1. Architecture overview

- **Runtime**: Node.js (ESM) with Fastify 5
- **Database**: PostgreSQL via Prisma
- **Cache / queues / pubsub**: Redis + BullMQ
- **Protocols**:
  - REST API under `/api/**`
  - WebSocket at `/ws`
  - Internal callbacks for CRE and simulate
- **External integrations**:
  - Thirdweb (wallet auth, quote signing)
  - Chainlink CRE (market create/seed/resolve, trade execution, agent key creation)
  - Tenderly Virtual TestNet (simulate chain)
  - x402 Thirdweb (payment for starting/extending simulations)

Process model:

- **API server** – `src/server.ts`  
  - Registers all routes (`/api/markets`, `/api/agents`, `/api/orders`, `/api/simulate`, `/api/settings`, etc.)
  - Manages WebSocket rooms and Redis subscriptions
  - Starts optional in‑process cron for `trigger-all` and CRE market sync
- **Agent worker** – `src/workers/agent-worker.ts`  
  - Consumes the `agent-prediction` BullMQ queue
  - Runs LLM‑based trading analysis and posts orders to the matching engine
- **Trades persistence worker** – `src/workers/trades-persistence.worker.ts`  
  - Listens to Redis trade events and writes trades / positions to Postgres

---

## 2. Major route groups and what they are for

Each route file under `src/routes` registers a cohesive area of the API.

- **`users.routes.ts`** – User records
  - `GET /api/users`, `/api/users/:id`, `/api/users/address/:address`
  - `POST /api/users` (create), `PATCH` / `DELETE` (self or API key)
- **`auth.routes.ts`** – Auth helpers
  - `GET /api/auth/me` – resolve current user from JWT (Thirdweb‑issued)
- **`register.routes.ts`** – First‑time registration
  - `GET /api/register/username/available` – check handle
  - `POST /api/register` – create `User` + initial `Agent` in one step
- **`agents.routes.ts`** – Agent CRUD and metrics
  - List public agents, list owner agents, fetch one agent, update strategy/model settings
  - Sync balances from on‑chain or Tenderly (`syncAgentBalance`, `syncTenderlyBalance`)
- **`markets.routes.ts`** – Market listing and LMSR pricing
  - `GET /api/markets` – list markets with stats
  - `GET /api/markets/:id` – full detail
  - `GET /api/markets/condition/:conditionId` – by condition id
  - `POST /api/markets` – create market (creator wallet or API key)
  - Pricing helpers call into LMSR engine and optional CRE pricing workflow
- **`orders.routes.ts`** – Order submission and CRE execution
  - `POST /api/orders` – validate payload, fetch market, enforce auth
  - Derives `userId` or `agentId`, validates signed quote for user orders
  - Calls matching engine (`submitOrder`), enqueues trades for persistence, and publishes WebSocket events
  - For user orders, calls CRE to execute the signed quote on chain; for agent orders, uses confidential trade execution via CRE
- **`positions.routes.ts`** – Positions API
  - Read‑only view of aggregated positions; mutations come from trades worker
- **`activities.routes.ts`** – Activity feeds
  - Recent actions per market and per user/agent, used for activity panels on the frontend
- **`user-balances.routes.ts`** – Vault and user balance endpoints
  - Balance fetch and adjustments (vault deposit/withdraw)
- **`settings.routes.ts`** – Profile + vault
  - `GET/PATCH /api/settings/profile`
  - `GET /api/settings/vault/balance`, deposit/withdraw endpoints
- **`agent-enqueue.routes.ts`** – Attach markets to agents
  - `POST /api/agent/enqueue` – owner/API key only; sets up repeated jobs and `AgentEnqueuedMarket` rows
- **`agent-markets-internal.routes.ts`** – Internal helpers for frontend/SDK
  - Batched views of which agents are attached to which markets
- **`simulate.routes.ts`** – Simulation sandbox
  - `GET /api/simulate/config` – Tenderly chain info (id, name, explorer)
  - `GET /api/simulate/payment-config` – x402 chain/config
  - `POST /api/simulate/start` – create simulation, fund Tenderly wallet if needed, discover markets by date range, create `AgentEnqueuedMarket` rows with `chainKey: "tenderly"`, enqueue jobs (batched to avoid Redis OOM)
  - `POST /api/simulate/extend` – extend duration and/or markets for an existing simulation (same queue and Tenderly flow)
  - `GET /api/simulations`, `GET /api/simulations/:id`, `DELETE /api/simulations/:id` – list/detail/remove simulations for the current user
- **`cre-callback.routes.ts`** – Chainlink CRE callbacks
  - Agent key creation, market `onchain-created` (single/batch), buy/sell confirmations
  - Called by the CRE workflow gateway; uses API key and content‑type normalization
- **`settlement-internal.routes.ts`** – Settlement deliberation and finalization
  - `POST /api/internal/settlement/run` – two‑agent LLM deliberation for market resolution; returns payout vector
  - `POST /api/internal/settlement/resolved` – mark market resolved when CRE writes the report on chain
- **`sdk-agent.routes.ts`, `sdk-api.routes.ts`** – SDK‑friendly endpoints
  - Registration and market access for external agents (e.g. OpenClaw/MCP style)

See [Backend Overview](https://github.com/nyuiela/sub0/blob/main/md/backend-overview.md) for general overview and structure.

---

## 3. Matching engine, trades, and WebSocket

### 3.1 Matching engine

- Implementation lives under `src/engine/*` and `src/workers/trades-queue.ts`.
- Orders are processed per `(marketId, outcomeIndex)` in a price‑time priority queue:
  - Bids: higher price first, earlier time first
  - Asks: lower price first, earlier time first
- Order types:
  - **LIMIT** – may rest in the book
  - **MARKET** – consume best prices up to quantity; no resting
  - **IOC** – fill what is available now and cancel the rest
- For each filled order:
  - A trade event is enqueued to a BullMQ trades queue
  - Redis pubsub broadcasts to appropriate WebSocket rooms

### 3.2 Trades persistence worker

- `src/workers/trades-persistence.worker.ts`:
  - Reads from the bull queue
  - Writes `Trade` records to Postgres
  - Updates `Position` rows and aggregate market stats
  - Publishes `MARKET_UPDATED` WebSocket messages (reason `stats` / `position`)

### 3.3 WebSocket hub

- Implemented in `src/services/websocket.service.ts` and wired in `src/server.ts`.
- Entry point: `GET /ws` using `@fastify/websocket`.
- Maintains:
  - Room membership (`market:{id}`, `markets`, `agent:{id}`, `market:{id}:user:{userId}`, etc.)
  - Mapping from sockets to rooms and filters (event types, user/agent scopes)
  - Heartbeat timers with `PING`/`PONG` messages
- Subscribes to Redis channels for:
  - `ORDER_BOOK_UPDATE`, `TRADES`, `MARKET_UPDATES`,
  - `AGENT_UPDATES`, `POSITION_UPDATES`, `USER_ASSET_CHANGES`,
  - AI analysis updates and agent market actions
- When a message arrives, it:
  - Maps Redis payloads to typed WebSocket events (see `src/types/websocket-events.ts`)
  - Optionally strips sensitive fields (e.g. EIP‑712 signatures) before sending to clients
  - Broadcasts to rooms based on filters

Frontend integration is documented in [Websocket Integration](https://github.com/nyuiela/sub0/blob/main/md/websocket.integration.md) and [Websocket Enhancements](https://github.com/nyuiela/sub0/blob/main/md/enhanced-ws.md).

---

## 4. Agents, discovery, and trigger‑all

The agent system is documented in depth in [Agent Trading](https://github.com/nyuiela/sub0/blob/main/md/agent.trading.system.md). At a high level:

- **AgentEnqueuedMarket** is the table that tracks which `(agentId, marketId, chainKey)` pairs should be traded.
- Enqueues can happen via:
  - Manual add from UI (`POST /api/agent/enqueue`)
  - Discovery in `runTriggerAll` (when `TRIGGER_ALL_CRON_ENABLED=true`)
- **Trigger‑all** (`services/trigger-all.service.ts`):
  - Discovers OPEN markets per active agent (main chain only)
  - Adds new `AgentEnqueuedMarket` rows up to per‑agent caps
  - Enqueues BullMQ jobs that the agent worker consumes
- Agent worker (`src/workers/agent-worker.ts`):
  - Loads agent, market, positions, and balances (main vs Tenderly)
  - Calls LLMs (Gemini, Grok, or OpenWebUI) to get a trading decision
  - Submits orders via the same order pipeline as user trades

Simulate uses the same worker, but the enqueued markets and chain config are flagged with `chainKey: "tenderly"` and date ranges.

---

## 5. CRE, Tenderly, and simulate

- **CRE integration**:
  - Uses HTTP gateway provided by `sub0cre` (see its README and md docs).
  - For user orders, sends pre‑signed LMSR quotes to CRE, which wraps with DON signatures and submits to the Sub0 / PredictionVault contracts.
  - For agent orders, uses agent keys created by CRE to sign trades confidentially.
  - For settlement, CRE calls backend internal settlement routes, then writes a report on chain and notifies backend.
- **Tenderly simulate chain**:
  - Separate RPC and contract addresses; loaded via `getTenderlyChainConfig`.
  - `simulate.routes.ts` ensures simulate wallets are funded (ETH + USDC) using Tenderly utilities before enqueuing jobs.
  - All `chainKey: "tenderly"` jobs run in this environment so users can backtest agents safely.

---

## 6. Environment and running locally

Baseline env vars are documented in the root `env.local.example` under the `sub0server` section.

Minimum required:

- `DATABASE_URL` – Postgres connection
- `REDIS_URL` – Redis connection
- `JWT_SECRET` – secret for user JWT verification / agent encryption fallback
- `PORT` – backend port (default 4000)
- `AUTH_DOMAIN`, `AUTH_COOKIE_NAME` – must match frontend config
- `THIRDWEB_SECRET_KEY`, `THIRDWEB_ADMIN_PRIVATE_KEY` – for auth + signing
- `API_KEY` – for internal and CRE callback routes
- `CORS_ORIGIN` – e.g. `http://localhost:3000`

For simulate and CRE you will also need:

- Chain RPC URLs (Sepolia, Tenderly)
- Contract addresses for Sub0/PredictionVault
- `CRE_HTTP_URL`, `CRE_HTTP_API_KEY`
- `X402_*` vars if payment is enforced for simulations

### Start services (local dev)

From `sub0server`:

```bash
pnpm install
# Make sure Postgres and Redis are running locally
pnpm db:generate
pnpm db:push   # or pnpm db:migrate
pnpm dev       # start API server on PORT (default 4000)
```

Optional workers:

```bash
pnpm worker           # agent worker
pnpm worker:trades    # trades persistence worker
```

Docker helpers (uses `docker-compose.yml` and `docker-compose.dev.yml`):

- `pnpm docker:dev` – backend + Redis + agent worker in Docker (dev)
- `pnpm docker:dev:down` – stop dev stack

Scripts and cron notes are in [Scripts](https://github.com/nyuiela/sub0server/blob/main/scripts/README.md).

---

## 7. Reference docs

For deeper integration or SDK work, start here:

- `sub0/md/backend-overview.md` – high‑level backend API summary
- `sub0server/md/backend-api.frontend.md` – detailed REST contract for frontend
- `sub0server/md/markets.api.md` – markets endpoints and data shapes
- `sub0server/md/agents.api.md` – agent endpoints and permissions
- `sub0server/md/orders-trades.api.md` – orders and trades
- `sub0server/md/settings.api.frontend.md` – settings/profile/vault endpoints
- `sub0server/md/enhanced-websocket-integration.frontend.md` – WebSocket events, rooms, filters

