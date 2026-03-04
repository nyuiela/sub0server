# LMSR Pricing WebSocket Integration Guide

Real-time LMSR (Logarithmic Market Scoring Rule) pricing updates via WebSocket. This allows users to get instant pricing quotes for markets based on specified quantity and outcome parameters.

---

## Overview

The LMSR pricing system works as follows:

1. **Frontend** requests pricing via `POST /api/markets/:id/pricing` or WebSocket
2. **Backend** sends request to CRE (Contract Runtime Environment)
3. **CRE** computes the LMSR pricing and returns result to `/api/cre/lmsr-pricing`
4. **Backend** broadcasts pricing result via WebSocket to subscribed clients
5. **Frontend** receives real-time pricing update with signature for on-chain execution

---

## 1. WebSocket Event

### LMSR_PRICING_UPDATE

Sent when CRE returns a pricing quote for a market.

**Payload:**

```typescript
{
  marketId: string;           // Backend market ID
  questionId: string;         // CRE question ID (market identifier)
  outcomeIndex: number;       // Outcome being priced (0 for Yes, 1 for No)
  quantity: string;          // Number of shares to buy/sell
  tradeCostUsdc: string;     // Total cost in USDC (raw amount, 6 decimals)
  deadline: string;          // Quote expiration timestamp (Unix)
  nonce: string;             // Unique nonce for this quote
  donSignature: string;      // Signed EIP-712 signature from oracle
  requestId: string;         // Unique request ID (correlates request/response)
  timestamp: string;       // ISO timestamp when received
}
```

**Example:**

```json
{
  "type": "LMSR_PRICING_UPDATE",
  "payload": {
    "marketId": "550e8400-e29b-41d4-a716-446655440000",
    "questionId": "0x18680f5c93c53690715ced2d0cb22bef40076309b26dba8dd362e89c2c0c76f1",
    "outcomeIndex": 1,
    "quantity": "3000000",
    "tradeCostUsdc": "2355440",
    "deadline": "1772620206",
    "nonce": "0",
    "donSignature": "0x00205f882f56889814c19d71aff791e7ef5e5fe2e199df372bd1193122c0e98e5ca8455e374d7e0cdd7adf433fc1eab57ab772d54ad323897ca4a826a4cd056e1c",
    "requestId": "req_abc123",
    "timestamp": "2026-03-04T10:30:00.000Z"
  }
}
```

---

## 2. Rooms

| Room | Description | Receives |
|------|-------------|----------|
| `market:{marketId}` | Public market room | All pricing updates for this market |
| `market:{marketId}:user:{userId}` | User-scoped room | Pricing updates requested by this user |
| `market:{marketId}:agent:{agentId}` | Agent-scoped room | Pricing updates requested by this agent |

**Subscribe to market pricing:**

```json
{
  "type": "SUBSCRIBE",
  "payload": {
    "room": "market:550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Subscribe with filters (only pricing updates):**

```json
{
  "type": "SUBSCRIBE",
  "payload": {
    "room": "market:550e8400-e29b-41d4-a716-446655440000",
    "filters": {
      "eventTypes": ["LMSR_PRICING_UPDATE", "ORDER_BOOK_UPDATE"]
    }
  }
}
```

---

## 3. Requesting Pricing

### REST API Endpoint

**POST** `/api/markets/:marketId/pricing`

**Request Body:**

```typescript
{
  outcomeIndex: number;    // Which outcome to price (0 = Yes, 1 = No)
  quantity: string;        // Number of shares (in market decimals)
  bParameter?: string;     // Optional: LMSR liquidity parameter
}
```

**Example Request:**

```json
{
  "outcomeIndex": 1,
  "quantity": "3000000",
  "bParameter": "1000000"
}
```

**Response:**

```typescript
{
  success: boolean;
  requestId: string;
  error?: string;
}
```

**Example Success Response:**

```json
{
  "success": true,
  "requestId": "req_abc123"
}
```

> Note: The actual pricing result arrives via WebSocket `LMSR_PRICING_UPDATE` event.

---

## 4. Frontend Implementation

### React Hook Example

```typescript
import { useEffect, useRef, useCallback, useState } from 'react';

interface PricingRequest {
  outcomeIndex: number;
  quantity: string;
  bParameter?: string;
}

interface PricingResult {
  marketId: string;
  questionId: string;
  outcomeIndex: number;
  quantity: string;
  tradeCostUsdc: string;
  deadline: string;
  nonce: string;
  donSignature: string;
  requestId: string;
  timestamp: string;
}

interface UseMarketPricingProps {
  marketId: string;
  userId?: string;
  onPricingUpdate?: (result: PricingResult) => void;
}

export function useMarketPricing({
  marketId,
  userId,
  onPricingUpdate,
}: UseMarketPricingProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const [pendingRequests, setPendingRequests] = useState<Set<string>>(new Set());
  const [isConnected, setIsConnected] = useState(false);

  // Connect to WebSocket
  useEffect(() => {
    const ws = new WebSocket(`wss://api.yourapp.com/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Subscribe to market room for pricing updates
      ws.send(JSON.stringify({
        type: 'SUBSCRIBE',
        payload: { 
          room: `market:${marketId}`,
          filters: { eventTypes: ['LMSR_PRICING_UPDATE', 'TRADE_EXECUTED'] }
        }
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'LMSR_PRICING_UPDATE') {
        const result = message.payload as PricingResult;
        
        // Check if this is a response to our pending request
        if (pendingRequests.has(result.requestId)) {
          setPendingRequests(prev => {
            const next = new Set(prev);
            next.delete(result.requestId);
            return next;
          });
          onPricingUpdate?.(result);
        }
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [marketId, onPricingUpdate]);

  // Request pricing function
  const requestPricing = useCallback(async (params: PricingRequest): Promise<string | null> => {
    try {
      const response = await fetch(`/api/markets/${marketId}/pricing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Pricing request failed');
      }

      // Track pending request
      setPendingRequests(prev => new Set(prev).add(data.requestId));
      
      return data.requestId;
    } catch (error) {
      console.error('Failed to request pricing:', error);
      return null;
    }
  }, [marketId]);

  return {
    isConnected,
    requestPricing,
    pendingRequestsCount: pendingRequests.size,
  };
}
```

### Usage in Component

```typescript
function MarketPricingPanel({ marketId }: { marketId: string }) {
  const [latestQuote, setLatestQuote] = useState<PricingResult | null>(null);
  const [quantity, setQuantity] = useState('1000000'); // 1 USDC worth
  const [outcomeIndex, setOutcomeIndex] = useState(0);

  const { isConnected, requestPricing, pendingRequestsCount } = useMarketPricing({
    marketId,
    onPricingUpdate: (result) => {
      setLatestQuote(result);
    },
  });

  const handleGetQuote = async () => {
    const requestId = await requestPricing({
      outcomeIndex,
      quantity,
    });
    
    if (requestId) {
      console.log('Pricing requested:', requestId);
    }
  };

  const handleExecuteTrade = async () => {
    if (!latestQuote) return;

    // Use the signature to execute on-chain
    const result = await executeTrade({
      marketId: latestQuote.questionId,
      outcomeIndex: latestQuote.outcomeIndex,
      quantity: latestQuote.quantity,
      tradeCostUsdc: latestQuote.tradeCostUsdc,
      nonce: latestQuote.nonce,
      deadline: latestQuote.deadline,
      donSignature: latestQuote.donSignature,
    });

    if (result.success) {
      setLatestQuote(null); // Clear quote after execution
    }
  };

  return (
    <div>
      <div className="connection-status">
        {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
        {pendingRequestsCount > 0 && ` (${pendingRequestsCount} pending)`}
      </div>

      <div className="pricing-controls">
        <select 
          value={outcomeIndex} 
          onChange={(e) => setOutcomeIndex(Number(e.target.value))}
        >
          <option value={0}>Yes</option>
          <option value={1}>No</option>
        </select>

        <input
          type="text"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="Quantity (in USDC units)"
        />

        <button onClick={handleGetQuote} disabled={!isConnected}>
          Get Quote
        </button>
      </div>

      {latestQuote && (
        <div className="quote-result">
          <h4>Quote Received</h4>
          <p>Cost: {formatUSDC(latestQuote.tradeCostUsdc)} USDC</p>
          <p>Expires: {new Date(Number(latestQuote.deadline) * 1000).toLocaleString()}</p>
          <button onClick={handleExecuteTrade}>
            Execute Trade
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 5. Backend Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend    │────▶│     CRE     │
│  (Request)  │     │  (/pricing)  │     │  (Compute)  │
└─────────────┘     └──────────────┘     └─────────────┘
       │                   │                    │
       │                   │◀───────────────────│
       │                   │  (Callback to      │
       │                   │   /api/cre/        │
       │                   │   lmsr-pricing)    │
       │                   │                    │
       │◀──────────────────│                    │
       │  (WebSocket       │                    │
       │   LMSR_PRICING    │                    │
       │   _UPDATE)        │                    │
       │                   │                    │
       ▼                   ▼                    ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend  │     │   Redis/WS   │     │     CRE     │
│  (Display)  │◀────│  (Broadcast) │     │  (Signed)   │
└─────────────┘     └──────────────┘     └─────────────┘
```

---

## 6. API Reference

### POST /api/markets/:marketId/pricing

Request a pricing quote for a market.

**Headers:**
- `Authorization: Bearer <jwt>` (if user-scoped)
- `x-api-key: <apiKey>` (if admin/agent)

**Body:**
```typescript
{
  outcomeIndex: number;  // Required: 0 or 1
  quantity: string;      // Required: amount in market decimals
  bParameter?: string;   // Optional: LMSR liquidity parameter
}
```

**Response 200:**
```json
{
  "success": true,
  "requestId": "req_abc123xyz"
}
```

**Response 400:**
```json
{
  "success": false,
  "error": "Invalid outcome index"
}
```

**Response 404:**
```json
{
  "success": false,
  "error": "Market not found"
}
```

---

### POST /api/cre/lmsr-pricing (CRE Callback)

Internal endpoint for CRE to return pricing results.

**Body:**
```typescript
{
  marketId: string;        // CRE question ID
  deadline: string;        // Unix timestamp
  donSignature: string;    // 0x-prefixed hex signature
  nonce: string;          // Unique nonce
  tradeCostUsdc: string;  // Cost in USDC
  requestId: string;       // Echo of request ID
  outcomeIndex?: number;  // Optional: outcome being priced
  quantity?: string;       // Optional: quantity requested
  metadata?: {
    backendMarketId?: string;
    userId?: string;
    agentId?: string;
  };
}
```

---

## 7. WebSocket Schema

### Subscribe with Filters

```json
{
  "type": "SUBSCRIBE",
  "payload": {
    "room": "market:550e8400-e29b-41d4-a716-446655440000",
    "filters": {
      "eventTypes": ["LMSR_PRICING_UPDATE"]
    }
  }
}
```

### LMSR_PRICING_UPDATE Event

```json
{
  "type": "LMSR_PRICING_UPDATE",
  "payload": {
    "marketId": "550e8400-e29b-41d4-a716-446655440000",
    "questionId": "0x18680f5c93c53690715ced2d0cb22bef40076309b26dba8dd362e89c2c0c76f1",
    "outcomeIndex": 1,
    "quantity": "3000000",
    "tradeCostUsdc": "2355440",
    "deadline": "1772620206",
    "nonce": "0",
    "donSignature": "0x00205f882f56889814c19d71aff791e7ef5e5fe2e199df372bd1193122c0e98e5ca8455e374d7e0cdd7adf433fc1eab57ab772d54ad323897ca4a826a4cd056e1c",
    "requestId": "req_abc123",
    "timestamp": "2026-03-04T10:30:00.000Z"
  },
  "requestId": "ws-msg-123"  // Optional: client message correlation
}
```

---

## 8. Error Handling

### WebSocket Errors

```json
{
  "type": "ERROR",
  "payload": {
    "code": "PRICING_TIMEOUT",
    "message": "Pricing request timed out after 30s"
  }
}
```

### Common Error Codes

| Code | Description | Action |
|------|-------------|--------|
| `PRICING_TIMEOUT` | CRE didn't respond in time | Retry request |
| `INVALID_MARKET` | Market ID not found | Check market ID |
| `INVALID_OUTCOME` | Outcome index out of range | Use 0 or 1 |
| `INSUFFICIENT_LIQUIDITY` | Not enough liquidity | Reduce quantity |
| `SIGNATURE_INVALID` | CRE signature failed | Report to admin |

---

## 9. Best Practices

### 1. Request Correlation
Always store the `requestId` and match it with the WebSocket response:

```typescript
const pendingRequests = new Map<string, (result: PricingResult) => void>();

// When requesting
const requestId = await requestPricing(params);
pendingRequests.set(requestId, (result) => {
  // Handle result
});

// When receiving WebSocket message
if (pendingRequests.has(message.payload.requestId)) {
  const handler = pendingRequests.get(message.payload.requestId);
  handler?.(message.payload);
  pendingRequests.delete(message.payload.requestId);
}
```

### 2. Quote Expiration
Always check the `deadline` before executing:

```typescript
function isQuoteValid(result: PricingResult): boolean {
  const deadlineMs = Number(result.deadline) * 1000;
  return Date.now() < deadlineMs - 60000; // 1 min buffer
}
```

### 3. Batch Pricing
For multiple outcomes, make parallel requests:

```typescript
const quotes = await Promise.all([
  requestPricing({ outcomeIndex: 0, quantity: '1000000' }),
  requestPricing({ outcomeIndex: 1, quantity: '1000000' }),
]);
```

### 4. Connection Resilience
Reconnect and re-subscribe on disconnect:

```typescript
useEffect(() => {
  const connect = () => {
    const ws = new WebSocket(url);
    ws.onclose = () => {
      setTimeout(connect, 3000); // Reconnect after 3s
    };
  };
  connect();
}, []);
```

---

## 10. Migration Guide

### From REST Polling

**Before (Polling):**
```typescript
// Poll every 5 seconds
const interval = setInterval(async () => {
  const price = await fetch(`/api/markets/${id}/price`);
  setPrice(price);
}, 5000);
```

**After (WebSocket):**
```typescript
// Real-time updates
useMarketPricing({
  marketId: id,
  onPricingUpdate: (result) => {
    setPrice(result.tradeCostUsdc);
  },
});
```

### Legacy Quote System

If you were using the old `lmsrPricesService.getPrice()`:

```typescript
// Old: Synchronous calculation
const price = calculateLmsrPrice(quantity, outcome, marketState);

// New: Real-time oracle pricing
const { requestPricing } = useMarketPricing({ marketId });
const requestId = await requestPricing({ quantity, outcomeIndex });
// Result arrives via WebSocket with valid signature
```

---

## 11. Security Considerations

1. **Signature Verification**: The `donSignature` should be verified before on-chain execution
2. **Deadline Checks**: Always verify the quote hasn't expired
3. **Request ID**: Use to prevent replay attacks
4. **WebSocket Auth**: User-scoped rooms require valid JWT

---

## 12. Testing

### WebSocket Test Script

```typescript
// test-pricing-ws.ts
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  // Subscribe to market
  ws.send(JSON.stringify({
    type: 'SUBSCRIBE',
    payload: { room: 'market:test-market-id' }
  }));

  // Request pricing via REST
  fetch('http://localhost:3000/api/markets/test-market-id/pricing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outcomeIndex: 0,
      quantity: '1000000'
    })
  });
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'LMSR_PRICING_UPDATE') {
    console.log('Pricing received:', msg.payload);
  }
};
```

---

**Last Updated:** March 2026
**Version:** 1.0 (LMSR Pricing WebSocket)
