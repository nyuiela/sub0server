# Agents API Reference

Reference for frontend integration: listing, fetching, and managing trading agents. Critical AI data (full agent metrics, tracks, reasoning logs) is restricted to the agent owner or API key.

---

## Overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/agents | User or API key | List agents (owner-only for JWT users) |
| GET | /api/agents/public | None | List basic agent info for main page (no sensitive data) |
| GET | /api/agents/:id | Owner or API key | Get one agent with full metrics |
| GET | /api/agents/:id/tracks | Owner or API key | Time-series data for charts |
| GET | /api/agents/:id/reasoning | Owner or API key | Paginated reasoning logs |
| POST | /api/agents | User or API key | Create an agent |
| PATCH | /api/agents/:id | Owner or API key | Update an agent |
| DELETE | /api/agents/:id | Owner or API key | Delete an agent |

**Permissions**

- **User (JWT):** List returns only that user's agents. `ownerId` query is ignored. Single agent, tracks, and reasoning require the agent to belong to the user.
- **API key:** List can optionally filter by `ownerId`. Single agent, tracks, and reasoning are allowed for any agent when using an API key.
- **Unauthenticated:** Use **GET /api/agents/public** for main-page listing (no auth). Other routes return 401 when unauthenticated.

**Agent fields (numeric as string where noted):** `id`, `ownerId`, `name`, `persona`, `publicKey`, `balance`, `tradedAmount`, `totalTrades`, `pnl`, `status` (ACTIVE | PAUSED | DEPLETED | EXPIRED), `modelSettings`, `templateId`, `createdAt`, `updatedAt`. Owner-only/full response adds: `currentExposure`, `maxDrawdown`, `winRate`, `totalLlmTokens`, `totalLlmCost`. `encryptedPrivateKey` is never returned.

---

## List agents (public, main page)

**GET /api/agents/public**

Returns a paginated list of agents with **basic, non-sensitive fields only**. No authentication required. Use this for the main page or any public listing.

**Authentication:** None.

**Query parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| status | string | No | One of: ACTIVE, PAUSED, DEPLETED, EXPIRED |
| limit | number | No | Page size (1–100). Default 20 |
| offset | number | No | Skip count. Default 0 |

**Response (200)**

```json
{
  "data": [
    {
      "id": "agent-uuid",
      "name": "My Agent",
      "status": "ACTIVE",
      "volume": "50.000000000000000000",
      "trades": 42,
      "pnl": "5.250000000000000000",
      "createdAt": "2025-02-20T12:00:00.000Z",
      "updatedAt": "2025-02-20T12:00:00.000Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

**Item shape:** `id`, `name`, `status`, `volume` (traded amount, string), `trades` (number), `pnl` (string), `createdAt`, `updatedAt` (ISO strings). No balance, owner, keys, or AI metrics.

**Errors**

- **400:** Invalid query. Response: `{ error: "Invalid query", details }`.

---

## List agents (authenticated)

**GET /api/agents**

Returns a paginated list of agents with full owner-scoped data. When authenticated with a user JWT, only that user's agents are returned; `ownerId` is not used. With an API key, `ownerId` is optional and filters by owner.

**Authentication:** Required (user JWT or API key). If using JWT and the user has no `userId` (e.g. not registered), response is **403**.

**Query parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| ownerId | string (UUID) | No | Filter by owner. **Only respected when using API key.** Ignored for JWT. |
| status | string | No | One of: ACTIVE, PAUSED, DEPLETED, EXPIRED |
| limit | number | No | Page size (1–100). Default 20 |
| offset | number | No | Skip count. Default 0 |

**Example request**

```
GET /api/agents?status=ACTIVE&limit=10&offset=0
Authorization: Bearer <jwt>
```

**Response (200)**

```json
{
  "data": [
    {
      "id": "agent-uuid",
      "ownerId": "user-uuid",
      "name": "My Agent",
      "persona": "Conservative trader",
      "publicKey": "0x...",
      "balance": "100.000000000000000000",
      "tradedAmount": "50.000000000000000000",
      "totalTrades": 42,
      "pnl": "5.250000000000000000",
      "currentExposure": "0.120000000000000000",
      "maxDrawdown": "0.050000000000000000",
      "winRate": 0.65,
      "totalLlmTokens": 12000,
      "totalLlmCost": "0.024000000000000000",
      "status": "ACTIVE",
      "modelSettings": {},
      "templateId": "template-uuid",
      "createdAt": "2025-02-20T12:00:00.000Z",
      "updatedAt": "2025-02-20T12:00:00.000Z",
      "owner": { "id": "user-uuid", "address": "0x..." },
      "strategy": null,
      "template": { "id": "template-uuid", "name": "Default" }
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0
}
```

**List item shape**

- All agent fields above (balance, tradedAmount, pnl, currentExposure, maxDrawdown, totalLlmCost as strings).
- **owner:** `{ id, address }`.
- **strategy:** strategy object or null.
- **template:** `{ id, name }` or null.

**Errors**

- **400:** Invalid query. Response: `{ error: "Invalid query", details }`.
- **401:** Missing or invalid auth.
- **403:** Forbidden: must be owner or use API key to list agents (e.g. JWT user with no userId).

---

## Get one agent

**GET /api/agents/:id**

Returns a single agent with full metrics. **Only the agent owner (JWT) or API key** can access this endpoint; others receive 403.

**Authentication:** Owner or API key required.

**Response (200)**

Same shape as a list item: agent fields (including `currentExposure`, `maxDrawdown`, `winRate`, `totalLlmTokens`, `totalLlmCost`), `owner`, `strategy`, `template`. Numeric amounts as strings.

**Errors**

- **401:** Unauthenticated.
- **403:** Forbidden: not the agent owner and not using API key.
- **404:** Agent not found.

---

## Get agent tracks

**GET /api/agents/:id/tracks**

Returns time-series records (e.g. daily) for charts: volume, trades, pnl, exposure, drawdown, LLM usage. **Owner or API key only.**

**Authentication:** Owner or API key required.

**Query parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| limit | number | No | Max records (1–365). Default 90 |
| from | string (ISO date) | No | Filter from date (inclusive) |
| to | string (ISO date) | No | Filter to date (inclusive) |

**Example request**

```
GET /api/agents/agent-uuid/tracks?limit=90&from=2025-02-01&to=2025-02-20
Authorization: Bearer <jwt>
```

**Response (200)**

```json
{
  "data": [
    {
      "id": "track-uuid",
      "agentId": "agent-uuid",
      "date": "2025-02-20",
      "volume": "100.000000000000000000",
      "trades": 5,
      "pnl": "2.500000000000000000",
      "exposure": "0.120000000000000000",
      "drawdown": "0.020000000000000000",
      "llmTokensUsed": 1500,
      "llmCost": "0.003000000000000000",
      "createdAt": "2025-02-20T12:00:00.000Z"
    }
  ]
}
```

**Track item shape**

- `id`, `agentId`, `date` (YYYY-MM-DD), `volume`, `trades`, `pnl`, `exposure`, `drawdown`, `llmTokensUsed`, `llmCost`, `createdAt`. Numeric amounts as strings except `trades` and `llmTokensUsed`.

**Errors**

- **401:** Unauthenticated.
- **403:** Forbidden: not owner and not API key.
- **404:** Agent not found (if ownership check is done by agent lookup).

---

## Get agent reasoning

**GET /api/agents/:id/reasoning**

Returns paginated reasoning logs (LLM context, reasoning, response, token usage, cost, risk, action). **Owner or API key only.**

**Authentication:** Owner or API key required.

**Query parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| limit | number | No | Page size (1–100). Default 20 |
| offset | number | No | Skip count. Default 0 |

**Example request**

```
GET /api/agents/agent-uuid/reasoning?limit=20&offset=0
Authorization: Bearer <jwt>
```

**Response (200)**

```json
{
  "data": [
    {
      "id": "reason-uuid",
      "agentId": "agent-uuid",
      "marketId": "market-uuid",
      "model": "gpt-4",
      "userContext": "{}",
      "reasoning": "Market sentiment suggests...",
      "response": "BUY",
      "promptTokens": 100,
      "completionTokens": 50,
      "totalTokens": 150,
      "estimatedCost": "0.001500000000000000",
      "riskScore": 0.3,
      "actionTaken": "LONG",
      "createdAt": "2025-02-20T12:00:00.000Z"
    }
  ],
  "total": 100,
  "limit": 20,
  "offset": 0
}
```

**Reasoning item shape**

- `id`, `agentId`, `marketId`, `model`, `userContext`, `reasoning`, `response`, `promptTokens`, `completionTokens`, `totalTokens`, `estimatedCost`, `riskScore`, `actionTaken`, `createdAt`. `estimatedCost` as string.

**Errors**

- **401:** Unauthenticated.
- **403:** Forbidden: not owner and not API key.

---

## Create agent

**POST /api/agents**

Creates an agent. With JWT, `ownerId` in body must match the authenticated user.

**Authentication:** User or API key. With JWT, body `ownerId` must equal `user.userId` or response is 403.

**Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ownerId | string (UUID) | Yes | Owner user id (must match JWT user if using JWT) |
| name | string | Yes | Agent name |
| persona | string | Yes | Agent persona description |
| publicKey | string | Yes | Public key |
| encryptedPrivateKey | string | Yes | Encrypted private key (not returned in responses) |
| modelSettings | object | Yes | Model configuration |
| templateId | string (UUID) | No | Optional template id |

**Response (201)**

Single agent object (same shape as GET /api/agents/:id), including `owner`. No `encryptedPrivateKey` in response.

**Errors**

- **400:** Validation failed. Response: `{ error: "Validation failed", details }`.
- **401:** Unauthenticated.
- **403:** User not found/not registered, or can only create agent for yourself.
- **404:** Owner not found.

---

## Update agent

**PATCH /api/agents/:id**

Updates an agent. Owner or API key only.

**Authentication:** Owner or API key required.

**Body (all optional)**

| Field | Type | Description |
|-------|------|-------------|
| name | string | Agent name |
| persona | string | Persona description |
| encryptedPrivateKey | string | Encrypted private key |
| modelSettings | object | Model configuration |
| status | string | ACTIVE, PAUSED, DEPLETED, EXPIRED |
| templateId | string (UUID) or null | Template id or disconnect |

**Response (200)**

Updated agent with `owner`, `strategy`. Same numeric/string conventions as GET.

**Errors**

- **400:** Validation failed.
- **401:** Unauthenticated.
- **403:** Not owner and not API key.
- **404:** Agent not found.

---

## Delete agent

**DELETE /api/agents/:id**

Deletes an agent. Owner or API key only.

**Authentication:** Owner or API key required.

**Response (204)**

No body.

**Errors**

- **401:** Unauthenticated.
- **403:** Not owner and not API key.

---

## Frontend integration summary

1. **Auth:** Send JWT in `Authorization: Bearer <token>` or API key in header (per backend convention). Unauthenticated requests to protected routes get 401.
2. **Main page / public list:** Use **GET /api/agents/public** (no auth) to show basic agent cards: name, status, volume, trades, pnl, createdAt/updatedAt. No balance or sensitive data.
3. **List agents (owned):** Use GET /api/agents when authenticated. As a logged-in user, you only see your own agents; do not pass `ownerId`. With API key, you can pass `ownerId` to filter.
4. **Detail, tracks, reasoning:** Use GET /api/agents/:id, GET /api/agents/:id/tracks, GET /api/agents/:id/reasoning only for agents the user owns (or with API key). On 403, show "You don't have access to this agent."
5. **Numeric fields:** Treat `balance`, `pnl`, `tradedAmount`, `currentExposure`, `maxDrawdown`, `totalLlmCost`, `volume`, `exposure`, `drawdown`, `llmCost`, `estimatedCost` as strings for precision; parse for display/calculations.
6. **Charts:** Use `/tracks` with `from`/`to` and `limit` (e.g. last 90 days). `date` is YYYY-MM-DD; use for x-axis.
7. **Reasoning:** Use `/reasoning` with `limit`/`offset` for pagination; `total` is total count.
