# Settings API Report for Frontend

Backend endpoints for profile, vault (balance/deposit/withdraw), and agent model settings. Use this to wire the settings UI. Auth is session/JWT only for these routes (no API key).

---

## 1. Authentication for Settings

- **Required:** JWT (cookie or `Authorization: Bearer <token>`). Same as existing auth.
- **Not allowed:** API key. Settings endpoints return 403 if called with API key only.
- **Current user:** Backend resolves the user from JWT (by `userId` or wallet `address`). All settings routes operate on this current user.

---

## 2. Profile Settings

**Base path:** `/api/settings/profile`

### GET /api/settings/profile

Returns the current user profile and optional summary stats.

**Response (200):**

```json
{
  "username": "string | null",
  "email": "string | null",
  "globalPnl": "string",
  "totalVolume": "string"
}
```

- `username`, `email`: From user record; null if not set.
- `globalPnl`, `totalVolume`: Decimal values as strings (for display).

**Errors:** 401 unauthenticated, 403 user not found or not registered.

### PATCH /api/settings/profile

Updates the current user profile.

**Body (all optional):**

```json
{
  "username": "string | null",
  "email": "string | null"
}
```

- `username`: Optional; max 64 characters. Empty string is stored as null.
- `email`: Optional; must be a valid email or empty string (stored as null).

**Response (200):** Same shape as GET profile (updated values plus `globalPnl`, `totalVolume`).

**Errors:** 400 validation failed (e.g. username length, invalid email), 401/403 as above.

---

## 3. Vault & Funds

**Base path:** `/api/settings/vault`

### GET /api/settings/vault/balance

Returns the current user’s Prediction Vault USDC balance.

**Response (200):**

```json
{
  "balance": "string"
}
```

- `balance`: USDC amount as string (e.g. `"0"`, `"100.50"`). Use for display; no rounding needed.

**Errors:** 401/403 as above.

### POST /api/settings/vault/deposit

Increments the user’s vault balance (backend records the deposit; on-chain/contract integration is separate).

**Body:**

```json
{
  "amount": "string"
}
```

- `amount`: Positive numeric string (e.g. `"10"`, `"25.50"`). Must match `/^\d+(\.\d+)?$/` and be &gt; 0.

**Response (200):**

```json
{
  "success": true,
  "balance": "string"
}
```

- `balance`: New balance after deposit.

**Errors:** 400 validation failed (invalid or non-positive amount), 401/403 as above.

### POST /api/settings/vault/withdraw

Decrements the user’s vault balance. Fails if balance would go negative.

**Body:** Same as deposit: `{ "amount": "string" }`.

**Response (200):** Same as deposit: `{ "success": true, "balance": "string" }`.

**Errors:** 400 validation failed or insufficient balance, 401/403 as above.

---

## 4. Agent Studio (modelSettings & OpenClaw)

Agent config continues to use existing agent endpoints. Backend now stores OpenClaw long text in a dedicated table and merges it into `modelSettings` on read.

**Endpoints:** Same as before.

- **GET /api/agents/:id** – Returns agent with full `modelSettings`, including merged `modelSettings.openclaw`.
- **PATCH /api/agents/:id** – Accepts full `modelSettings`; if `modelSettings.openclaw` is present, it is stored in optimized text storage and merged back on GET.

### GET /api/agents/:id response (relevant fields)

- `name`, `persona`, `modelSettings`, `strategy`, `owner`, `template`, and all existing agent fields.
- `modelSettings` always includes:
  - Top-level: `model`, `temperature`, `strategyPreference`, `maxSlippage`, `spreadTolerance`, `tools`, etc.
  - `modelSettings.openclaw`: `soul`, `persona`, `skill`, `methodology`, `failed_tests`, `context`, `constraints` (strings; may be omitted if empty).
- `strategy`: `{ preference?, maxSlippage?, spreadTolerance? }` (from AgentStrategy). Frontend can use either `strategy` or `modelSettings` for strategy fields.

### PATCH /api/agents/:id body (relevant shape)

Send the same shape the frontend already uses; backend accepts and persists it (OpenClaw fields are stored in text columns; rest in JSON).

**Example:**

```json
{
  "name": "string",
  "persona": "string",
  "modelSettings": {
    "model": "string",
    "temperature": 0,
    "strategyPreference": "AMM_ONLY | ORDERBOOK | HYBRID",
    "maxSlippage": 0.1,
    "spreadTolerance": 0,
    "openclaw": {
      "soul": "string",
      "persona": "string",
      "skill": "string",
      "methodology": "string",
      "failed_tests": "string",
      "context": "string",
      "constraints": "string"
    },
    "tools": {
      "internetSearch": true,
      "newsCrawler": false,
      "twitter": false,
      "sportsData": false
    }
  }
}
```

- **Validation:** `name` 1–120 chars; `persona` max 50_000; `modelSettings` accepted as documented in the Settings API report. OpenClaw fields are optional; each stored as text (max 50_000 equivalent server-side).

**Response (200):** Same shape as GET /api/agents/:id (updated agent with merged `modelSettings`).

---

## 5. Summary Table

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/settings/profile | GET | Get username, email, globalPnl, totalVolume |
| /api/settings/profile | PATCH | Update username, email |
| /api/settings/vault/balance | GET | Get vault USDC balance |
| /api/settings/vault/deposit | POST | Deposit (body: `amount` string) |
| /api/settings/vault/withdraw | POST | Withdraw (body: `amount` string) |
| /api/agents/:id | GET | Get agent (modelSettings includes merged openclaw) |
| /api/agents/:id | PATCH | Update agent (modelSettings incl. openclaw) |

---

## 6. Frontend Wiring Notes

1. **Profile tab:** Call GET profile on load; on submit call PATCH profile with `username`/`email`. Use `globalPnl` and `totalVolume` for summary cards.
2. **Vault tab:** Call GET vault/balance for display. Deposit/withdraw forms POST to vault/deposit and vault/withdraw with `{ amount: "..." }`; then refetch balance or use returned `balance`.
3. **Agent Studio:** Keep using GET/PATCH `/api/agents/:id`. Ensure form state includes `modelSettings.openclaw` and `modelSettings.tools`; backend persists and returns them in the same shape.
4. **Credentials:** Send cookies (or Bearer token) with every request; no API key for settings.
