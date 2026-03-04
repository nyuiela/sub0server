#!/usr/bin/env tsx

/**
 * Add initial orders to order book for agent trading simulation
 * This creates the actual orders that populate the in-memory order book
 */

import { config } from "dotenv";
config();

import { getOrderBook } from "../engine/matching-engine.js";
import { getPrismaClient } from "../lib/prisma.js";

// Market IDs from our simulation  
const MARKET_IDS = [
  "512d0e10-3fbf-45c8-8c2d-6f42fe500b97",
  "3a4a2e1d-fe6c-4730-b5ce-3f6ecd4208fe", 
  "f4720004-d951-4e60-a70e-ecfb7b8ba454",
];

// Initial order parameters - create a spread
const INITIAL_BID_PRICE = "0.45"; // 45% probability (buy lower)
const INITIAL_ASK_PRICE = "0.55"; // 55% probability (sell higher)
const INITIAL_QUANTITY = "1000000000000000000"; // 1 ETH worth

async function main(): Promise<void> {
  console.log("Adding initial orders to order books...");
  console.log(`Markets: ${MARKET_IDS.length}`);
  
  const prisma = getPrismaClient();
  
  for (const marketId of MARKET_IDS) {
    console.log(`\nProcessing market: ${marketId}`);
    
    try {
      // Get market info to check outcomes
      const market = await prisma.market.findUnique({
        where: { id: marketId },
        select: { id: true, name: true, outcomes: true }
      });
      
      if (!market) {
        console.log(`❌ Market not found`);
        continue;
      }
      
      console.log(`Market: ${market.name}`);
      
      // Handle outcomes - it's stored as JSON in the database
      const outcomes = Array.isArray(market.outcomes) ? market.outcomes as string[] : [];
      console.log(`Outcomes: ${outcomes.join(", ")}`);
      
      // Add orders for each outcome
      for (let outcomeIndex = 0; outcomeIndex < outcomes.length; outcomeIndex++) {
        const outcome = outcomes[outcomeIndex];
        console.log(`\n  Outcome ${outcomeIndex}: ${outcome}`);
        
        // Get order book for this outcome
        const orderBook = getOrderBook(marketId, outcomeIndex);
        
        // Add initial bid order (buy order) - use processOrder instead of addOrder
        const bidOrder = {
          id: `initial-bid-${marketId}-${outcomeIndex}`,
          marketId,
          outcomeIndex,
          side: "BID" as const,
          type: "LIMIT" as const,
          price: INITIAL_BID_PRICE,
          quantity: INITIAL_QUANTITY,
          remainingQty: INITIAL_QUANTITY,
          userId: "platform-liquidity",
          createdAt: new Date(),
        };
        
        // Add initial ask order (sell order)
        const askOrder = {
          id: `initial-ask-${marketId}-${outcomeIndex}`,
          marketId,
          outcomeIndex,
          side: "ASK" as const,
          type: "LIMIT" as const,
          price: INITIAL_ASK_PRICE,
          quantity: INITIAL_QUANTITY,
          remainingQty: INITIAL_QUANTITY,
          userId: "platform-liquidity",
          createdAt: new Date(),
        };
        
        // Add orders to the book using processOrder
        const bidResult = orderBook.processOrder(bidOrder);
        const askResult = orderBook.processOrder(askOrder);
        
        console.log(`    ✅ Added bid order at ${INITIAL_BID_PRICE} (${bidResult.trades.length} trades)`);
        console.log(`    ✅ Added ask order at ${INITIAL_ASK_PRICE} (${askResult.trades.length} trades)`);
      }
      
    } catch (error) {
      console.error(`Error processing market:`, error);
    }
  }
  
  console.log("\nOrder book liquidity addition complete!");
  
  // Verify order books
  console.log("\nVerifying order books:");
  for (const marketId of MARKET_IDS) {
    const book0 = getOrderBook(marketId, 0);
    const snapshot0 = book0.getSnapshot();
    
    console.log(`Market ${marketId}:`);
    console.log(`  Outcome 0: ${snapshot0.bids.length} bids, ${snapshot0.asks.length} asks`);
    
    if (snapshot0.bids.length > 0) {
      console.log(`    Best bid: ${snapshot0.bids[0].price} (${snapshot0.bids[0].quantity})`);
    }
    if (snapshot0.asks.length > 0) {
      console.log(`    Best ask: ${snapshot0.asks[0].price} (${snapshot0.asks[0].quantity})`);
    }
  }
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
