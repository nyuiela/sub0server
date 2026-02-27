# Agent worker and Run analysis setup

Step-by-step setup so "Run analysis" on the Simulate page triggers the AI agent (no Docker Redis required).

---

## 1. Prerequisites

- Node 18+ and pnpm (or npm) in `sub0server`
- PostgreSQL running and `DATABASE_URL` in `sub0server/.env`
- A running Redis instance (see step 2)

---

## 2. Redis (choose one)

You do **not** need a full Docker stack. Use any of the following.

### Option A – Redis via Docker

If you have Docker but do not want to run backend/worker in Docker:

Use **Docker Compose** (not plain `docker`). The command is run by the Compose CLI:

```bash
cd sub0server
docker-compose up -d redis
```

If you have Docker Compose V2 as a plugin, the same command is:

```bash
docker compose up -d redis
```

If you see `unknown shorthand flag: 'd'` or `unknown flag: --profile`, your shell is not using Compose (e.g. `docker compose` is missing or different). Use `docker-compose` (with hyphen) or install [Docker Compose](https://docs.docker.com/compose/install/). On Kali/Debian: `sudo apt install docker-compose-plugin` or use Option B (install Redis on the host).

Then set in `sub0server/.env`:

```env
REDIS_URL=redis://localhost:6379
```

### Option B – Redis installed on the host

**Linux (Debian/Ubuntu):**

```bash
sudo apt update && sudo apt install -y redis-server
sudo systemctl start redis-server
# optional: sudo systemctl enable redis-server
```

**macOS:**

```bash
brew install redis
brew services start redis
```

**Windows:** Use WSL and install Redis inside WSL, or use Option C.

In `sub0server/.env`:

```env
REDIS_URL=redis://localhost:6379
```

### Option C – Hosted Redis

Use a free tier (e.g. Upstash, Redis Cloud). Create a Redis instance and copy the connection URL.

In `sub0server/.env`:

```env
REDIS_URL=redis://default:YOUR_PASSWORD@YOUR_HOST:PORT
```

---

## 3. Environment in `sub0server/.env`

Ensure these exist (add or edit in `sub0server/.env`):

| Variable | Required | Example / note |
|----------|----------|----------------|
| `DATABASE_URL` | Yes | `postgresql://user:password@localhost:5432/sub0?schema=public` |
| `REDIS_URL` | Yes | `redis://localhost:6379` (or Option B/C URL) |
| `JWT_SECRET` | Yes | Any long random string |
| `API_KEY` | Yes for trigger-all / cron | e.g. `openssl rand -hex 32` |
| `AGENT_TRADING_ENABLED` | Yes for Run analysis | `true` |
| `PORT` | Optional | Default 3000; backend uses this |

Example minimal block:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/sub0?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="your-secret"
API_KEY="your-api-key"
AGENT_TRADING_ENABLED=true
PORT=4000
```

---

## 4. Database migration and Prisma client

From `sub0server`:

```bash
cd sub0server
pnpm install
pnpm db:migrate
pnpm db:generate
```

If you use production-style migrations:

```bash
npx prisma migrate deploy
npx prisma generate
```

This applies the `nextRunAt` migration and updates the Prisma client.

---

## 5. Start the backend

In a terminal:

```bash
cd sub0server
pnpm dev
```

Or:

```bash
npm run dev
```

Leave this running. Backend must be up so the worker can call it and the frontend can enqueue jobs.

---

## 6. Start the agent worker

In a **second** terminal, same directory and same `.env`:

```bash
cd sub0server
AGENT_TRADING_ENABLED=true pnpm worker
```

Or ensure `AGENT_TRADING_ENABLED=true` in `.env` and run:

```bash
pnpm worker
```

Or:

```bash
npm run worker
```

Leave this running. When you click "Run analysis", the backend enqueues jobs to Redis; this process consumes them and runs the AI analysis (and optional trading).

---

## 7. Optional – scheduled analysis (cron)

If you want analysis to run on a schedule without clicking "Run analysis":

- **With Docker Compose:**  
  Start the cron profile (uses same `docker-compose.yml`):  
  `docker-compose --profile cron up -d`  
  (Or with Compose V2: `docker compose --profile cron up -d`.)  
  Ensure `API_KEY` is set in `.env` so the cron container can call `POST /api/agent/trigger-all`.

- **Without Docker:**  
  Use a system cron or a scheduler to call:

  ```bash
  curl -X POST "http://localhost:4000/api/agent/trigger-all" -H "x-api-key: YOUR_API_KEY"
  ```

  Replace port and `YOUR_API_KEY` with your backend port and `API_KEY` from `.env`.

---

## Checklist

- [ ] Redis running (Docker / host / hosted) and `REDIS_URL` in `sub0server/.env`
- [ ] `DATABASE_URL`, `JWT_SECRET`, `API_KEY` in `sub0server/.env`
- [ ] `AGENT_TRADING_ENABLED=true` in `sub0server/.env`
- [ ] `pnpm db:migrate` and `pnpm db:generate` run in `sub0server`
- [ ] Backend running (`pnpm dev`) in one terminal
- [ ] Agent worker running (`pnpm worker`) in a second terminal

After this, "Run analysis" on the Simulate page should enqueue jobs and the worker should process them.

---

## Balance and chains

The worker decides whether the agent can trade using **Agent.balance** from the database. That value is normally synced from the **main chain** (e.g. Sepolia) via `POST /api/agents/:id/sync-balance`, which uses `CHAIN_RPC_URL` and the collateral token (e.g. USDC) on that chain.

- **Production / Tracker:** Ensure the agent wallet has USDC on the main chain and call sync-balance so the DB is up to date; the worker then uses that balance.
- **Simulate:** "Request funding" tops up the agent wallet on the **Tenderly** simulate chain (0.1 ETH + 20,000 USDC). After a successful funding request, the backend updates **Agent.balance** in the DB to 20,000 so the worker sees sufficient balance. **Agent.balance is also updated whenever the Simulate page fetches balance** (GET /api/simulate/balance): the backend writes the USDC balance read from Tenderly into the DB so the DB stays in sync with the simulate chain. After "Run analysis", the frontend refetches balance (after a short delay) so the DB is updated again. For Simulate-only deployments, do not set CHAIN_RPC_URL so the worker does not call sync-balance after orders (which would overwrite with main chain).
- **Production:** When CHAIN_RPC_URL is set, the worker calls POST /api/agents/:id/sync-balance after every successful order so the DB is updated from the main chain after each trade.

---

## Simulate and Tenderly

Everything under the **Simulate** surface that talks to a chain uses **strictly Tenderly** (when Tenderly env is set):

- **Simulate config** (`GET /api/simulate/config`) – chain id, name, explorer from Tenderly.
- **Simulate balance** (`GET /api/simulate/balance`) – native and USDC balances read from the Tenderly chain.
- **Simulate eligibility** (`GET /api/simulate/eligibility`) – cooldown for funding only; no chain read.
- **Simulate funding** (`POST /api/simulate/fund`) – 0.1 ETH + 20,000 USDC are set/added on the Tenderly chain via Tenderly Admin RPC.

So: balance display, funding, and network info on the Simulate page all use the Tenderly Virtual TestNet only. The agent worker and order matching engine do not switch chain by context; the worker uses **Agent.balance** from the DB (which we set after simulate funding so Run analysis can pass the balance check). For a fully Tenderly-based Simulate flow, use Tenderly for funding and avoid syncing agent balance from the main chain so the worker keeps using the simulated balance.
