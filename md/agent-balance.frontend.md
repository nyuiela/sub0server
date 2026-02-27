# Agent balance sync – frontend invocation

How to trigger an agent balance sync and receive live updates when the stored balance changes.

---

## When to sync

- After the user deposits USDC (or collateral) to the agent wallet.
- After any transfer that changes the agent’s on-chain balance.
- When opening the agent detail page, to ensure the displayed balance matches the chain.

---

## 1. Trigger sync (HTTP)

**POST /api/agents/:id/sync-balance**

- **Auth:** Owner JWT or API key (same as other agent routes).
- **Response:** `{ balance, updated, previousBalance?, error? }`.
  - `balance`: current balance (string). Matches chain; DB is updated when `updated` is true.
  - `updated`: true if DB was updated and a broadcast was sent.
  - `previousBalance`: set only when `updated` is true.
  - `error`: set when sync could not run (e.g. no wallet, RPC failure).

Example: after a deposit flow, call this endpoint with the agent id; then either refetch the agent or rely on the WebSocket event (below) to update the UI.

---

## 2. Receive updates (WebSocket)

Subscribe to room `agent:{agentId}` to get balance updates when the backend syncs and finds a change.

**Subscribe:**

```json
{ "type": "SUBSCRIBE", "payload": { "room": "agent:<agentId>" } }
```

**Event:** `AGENT_UPDATED`

**Payload:** `{ agentId, balance?, reason?: "balance" }`

When you receive this, update the agent’s balance in local state (or refetch GET /api/agents/:id). Unsubscribe when leaving the agent view: `{ "type": "UNSUBSCRIBE", "payload": { "room": "agent:<agentId>" } }`.

---

## 3. Flow summary

1. User completes deposit (or any balance-changing action).
2. Frontend calls **POST /api/agents/:id/sync-balance**.
3. If response has `updated: true`, the UI can use `response.balance` immediately; any other client subscribed to `agent:{agentId}` will receive `AGENT_UPDATED` with the new balance.
4. On the agent detail page, subscribe to `agent:{agentId}` on mount so balance updates in real time when sync runs (e.g. from another tab or after deposit).

See **agents.api.md** (Sync agent balance) and **websocket-integration.frontend.md** (AGENT_UPDATED, room `agent:{agentId}`) for full API details.
