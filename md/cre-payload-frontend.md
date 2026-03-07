# CRE Payload – Frontend Integration

This document describes how the frontend receives and uses **crePayload** (CRE execution result: transaction hash, quote fields, and optional errors) via WebSocket and REST.

---

## 1. What is crePayload?

When a user or agent places a **market order** (or a limit order is filled), the backend sends the trade to **CRE** (Confidential Reporting Environment) to execute on-chain. CRE returns:

- **Sync path:** Backend gets `txHash` in the HTTP response and can include it immediately in the trade response and in the first WebSocket broadcast.
- **Callback path:** CRE executes asynchronously and later POSTs to `/api/cre/buy` or `/api/cre/sell` with the same quote fields plus `txHash` (or `txHashes`) and optional `errors`. The backend stores this in the order’s `crePayload` and broadcasts it so the frontend can show the final tx hash and any errors.

The frontend never receives sensitive fields (`userSignature`, `conditionId`); only the following are exposed.

---

## 2. Where crePayload appears

### 2.1 WebSocket: `TRADE_EXECUTED`

When a trade is broadcast, the payload may include `txHash` and/or `crePayload` when available (e.g. sync execution or after the order was already updated by a CRE callback).

**Event:** `TRADE_EXECUTED`  
**Room:** `market:{marketId}`

**Payload shape:**

```ts
{
  tradeId: string;
  marketId: string;
  outcomeIndex?: number;
  side: "long" | "short";
  size: string;
  price: string;
  executedAt: string;   // ISO 8601
  userId?: string;
  agentId?: string;
  txHash?: string;      // Present when CRE execution result is available
  crePayload?: {        // Present when available (sync or after callback)
    questionId?: string;
    outcomeIndex?: number;
    buy?: boolean;
    quantity?: string;
    tradeCostUsdc?: string;
    nonce?: string;
    deadline?: string;
    users?: string[];
    txHash?: string;
    txHashes?: string[];
    errors?: unknown[];
  };
}
```

- Use **`txHash`** (top-level or inside `crePayload`) to build an explorer link, e.g. `https://sepolia.etherscan.io/tx/${txHash}`.
- If **`crePayload.errors`** is present and non-empty, show a warning or error state for that trade/order.

### 2.2 WebSocket: `ORDER_CRE_PAYLOAD`

When CRE callbacks (POST `/api/cre/buy` or `/api/cre/sell`), the backend updates the order’s `crePayload` and broadcasts this event so the frontend can attach the tx hash and errors to the correct order even if the trade was already shown without them.

**Event:** `ORDER_CRE_PAYLOAD`  
**Room:** `market:{marketId}`

**Payload shape:**

```ts
{
  orderId: string;
  marketId: string;
  outcomeIndex?: number;
  side?: "BID" | "ASK";
  crePayload: {
    questionId?: string;
    outcomeIndex?: number;
    buy?: boolean;
    quantity?: string;
    tradeCostUsdc?: string;
    nonce?: string;
    deadline?: string;
    users?: string[];
    txHash?: string;
    txHashes?: string[];
    errors?: unknown[];
  };
}
```

**Frontend usage:**

1. Subscribe to `market:{marketId}` (same as for trades and order book).
2. On **`ORDER_CRE_PAYLOAD`**, find the order in your local state by `orderId` (or by `marketId` + `outcomeIndex` + `side` if you don’t store orderId).
3. Update that order’s display:
   - Set or replace `crePayload` (or at least `txHash` / `txHashes` and `errors`).
   - Build explorer link from `crePayload.txHash` or first element of `crePayload.txHashes`.
   - If `crePayload.errors?.length > 0`, show an error/warning state for that order.

---

## 3. REST: Order and trade responses

- **GET /api/orders** (or order by id): The `crePayload` field on the order object may contain the same shape as above (without `userSignature` / `conditionId`). Use it to show `txHash` and `errors` for that order.
- **POST /api/orders** (market order): The response can include `txHash` at the top level when CRE returns it synchronously. The same order, when fetched later or updated via `ORDER_CRE_PAYLOAD`, may have a fuller `crePayload` with `txHash` and `errors`.

---

## 4. Integration checklist

| Task | How |
|------|-----|
| Show tx link for a trade | Use `TRADE_EXECUTED.payload.txHash` or `TRADE_EXECUTED.payload.crePayload?.txHash` (or first of `crePayload.txHashes`). |
| Show tx link for an order | Use `order.crePayload.txHash` or first of `order.crePayload.txHashes`; update from `ORDER_CRE_PAYLOAD` when received. |
| Handle late tx hash | Listen for `ORDER_CRE_PAYLOAD`; match by `orderId` and merge `crePayload` into the order in UI state. |
| Show CRE errors | If `crePayload.errors` is non-empty, display a warning/error for that order or trade. |
| Subscribe | Subscribe to room `market:{marketId}` to receive both `TRADE_EXECUTED` and `ORDER_CRE_PAYLOAD`. |

---

## 5. Example: merging ORDER_CRE_PAYLOAD in state

```ts
// Pseudocode
function onOrderCrePayload(payload: OrderCrePayloadUpdatePayload) {
  const order = orders.find(o => o.id === payload.orderId);
  if (!order) return;
  order.crePayload = { ...order.crePayload, ...payload.crePayload };
  // Re-render row: show tx link from order.crePayload.txHash, errors from order.crePayload.errors
}
```

---

## 6. Summary

- **crePayload** is the CRE execution result stored on the order and (when available) sent with trades.
- It is broadcast via **TRADE_EXECUTED** (with optional `crePayload` and `txHash`) and **ORDER_CRE_PAYLOAD** (when CRE callbacks and updates the order).
- Frontend receives only safe fields (no signatures); use **txHash** / **txHashes** for explorer links and **errors** for error handling.
