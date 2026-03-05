#!/usr/bin/env tsx

/**
 * Add liquidity to backend server's order books via API
 * This ensures the backend process has the order book liquidity
 */

import { config } from "dotenv";
config();

// Market IDs and order book parameters
const MARKET_LIQUIDITY = [
  {
    marketId: "22dc3e85-1755-4d1a-a9a5-77df4cce717d",
    outcomeIndex: 0,
    bidPrice: "0.45",
    askPrice: "0.55",
    quantity: "100000000", // 100 USDC in raw format (6 decimals)
  },
  {
    marketId: "22dc3e85-1755-4d1a-a9a5-77df4cce717d",
    outcomeIndex: 1,
    bidPrice: "0.45",
    askPrice: "0.55",
    quantity: "100000000",
  },
  {
    marketId: "0ca4fdde-c97a-4ef9-8d9c-44aab2123edd",
    outcomeIndex: 0,
    bidPrice: "0.45",
    askPrice: "0.55",
    quantity: "100000000",
  },
  {
    marketId: "0ca4fdde-c97a-4ef9-8d9c-44aab2123edd",
    outcomeIndex: 1,
    bidPrice: "0.45",
    askPrice: "0.55",
    quantity: "100000000",
  },
  {
    marketId: "439687d2-ccdc-42d0-9cc0-218fca378d3c",
    outcomeIndex: 0,
    bidPrice: "0.45",
    askPrice: "0.55",
    quantity: "100000000",
  },
  {
    marketId: "439687d2-ccdc-42d0-9cc0-218fca378d3c",
    outcomeIndex: 1,
    bidPrice: "0.45",
    askPrice: "0.55",
    quantity: "100000000",
  },
];

async function addLiquidityToBackend(): Promise<void> {
  console.log("Adding liquidity to backend order books...");
  console.log(`Markets to process: ${MARKET_LIQUIDITY.length}`);

  const apiKey = process.env.API_KEY;
  const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";

  if (!apiKey?.trim()) {
    console.error("API_KEY not set in environment variables");
    process.exit(1);
  }

  for (const liquidity of MARKET_LIQUIDITY) {
    console.log(`\nProcessing: Market ${liquidity.marketId.slice(0, 8)}... Outcome ${liquidity.outcomeIndex}`);

    try {
      // Add BID order
      console.log(`  Adding BID order at ${liquidity.bidPrice} (${Number(liquidity.quantity) / 1000000} USDC)`);

      const bidResponse = await fetch(`${backendUrl}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          marketId: liquidity.marketId,
          outcomeIndex: liquidity.outcomeIndex,
          side: "BID",
          type: "LIMIT",
          price: liquidity.bidPrice,
          quantity: liquidity.quantity,
          agentId: "5cff6b3a-4d88-4455-b4da-d9f2ffd04130", // Use our real agent ID
          chainKey: "main",
        }),
      });

      if (bidResponse.ok) {
        const bidResult = await bidResponse.json();
        console.log(`    ✅ BID order submitted: ${bidResult.orderId || 'success'}`);
      } else {
        const errorText = await bidResponse.text();
        console.log(`    ❌ BID order failed: ${bidResponse.status} - ${errorText}`);
      }

      // Add ASK order
      console.log(`  Adding ASK order at ${liquidity.askPrice} (${Number(liquidity.quantity) / 1000000} USDC)`);

      const askResponse = await fetch(`${backendUrl}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          marketId: liquidity.marketId,
          outcomeIndex: liquidity.outcomeIndex,
          side: "ASK",
          type: "LIMIT",
          price: liquidity.askPrice,
          quantity: liquidity.quantity,
          agentId: "5cff6b3a-4d88-4455-b4da-d9f2ffd04130", // Use our real agent ID
          chainKey: "main",
        }),
      });

      if (askResponse.ok) {
        const askResult = await askResponse.json();
        console.log(`    ✅ ASK order submitted: ${askResult.orderId || 'success'}`);
      } else {
        const errorText = await askResponse.text();
        console.log(`    ❌ ASK order failed: ${askResponse.status} - ${errorText}`);
      }

    } catch (error) {
      console.error(`  Error processing market ${liquidity.marketId}:`, error);
    }
  }

  console.log("\nLiquidity addition complete!");

  // Verify order books
  console.log("\nVerifying order books...");
  for (const liquidity of MARKET_LIQUIDITY) {
    try {
      const response = await fetch(`${backendUrl}/api/markets/${liquidity.marketId}`);
      if (response.ok) {
        const market = await response.json();
        const snapshot = market.orderBookSnapshot;

        if (snapshot && snapshot.outcomeIndex === liquidity.outcomeIndex) {
          console.log(`Market ${liquidity.marketId.slice(0, 8)}... Outcome ${liquidity.outcomeIndex}:`);
          console.log(`  Bids: ${snapshot.bids?.length || 0}`);
          console.log(`  Asks: ${snapshot.asks?.length || 0}`);

          if (snapshot.bids?.length > 0) {
            console.log(`  Best bid: ${snapshot.bids[0].price}`);
          }
          if (snapshot.asks?.length > 0) {
            console.log(`  Best ask: ${snapshot.asks[0].price}`);
          }
        }
      }
    } catch (error) {
      console.error(`Error verifying market ${liquidity.marketId}:`, error);
    }
  }
}

addLiquidityToBackend().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
