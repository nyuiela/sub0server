#!/usr/bin/env tsx

/**
 * Add liquidity to markets for agent trading simulation
 */

import { config } from "dotenv";
config();

import { seedMarketLiquidityOnChain } from "../services/seed-market-liquidity.service.js";

// Market question IDs from our simulation
const MARKET_QUESTION_IDS = [
  "0xd035c6ade15c01188f5a7c17e15be4d03b50868760f179a4975552336c156145",
  "0x3c2e5e8edc0176579f8ca75e1af87fed62d56fb53038c4c8e943dba162647055", 
  "0x9293ab7a85f99fbf607f812e7b408bd553cbf484fba72b5f6a3eb921b23a3fc4",
];

// Amount of USDC to add (1,000,000 USDC = 1 million with 6 decimals)
const LIQUIDITY_AMOUNT_USDC = 1000000000000n; // 1,000,000 USDC

async function main(): Promise<void> {
  console.log("Adding liquidity to markets...");
  console.log(`Markets: ${MARKET_QUESTION_IDS.length}`);
  console.log(`Amount: ${LIQUIDITY_AMOUNT_USDC.toString()} USDC (${Number(LIQUIDITY_AMOUNT_USDC) / 1000000}M USDC)`);
  
  for (const questionId of MARKET_QUESTION_IDS) {
    console.log(`\nProcessing market: ${questionId}`);
    
    try {
      const success = await seedMarketLiquidityOnChain(
        questionId as `0x${string}`,
        LIQUIDITY_AMOUNT_USDC
      );
      
      if (success) {
        console.log(`✅ Liquidity added successfully`);
      } else {
        console.log(`❌ Failed to add liquidity`);
      }
    } catch (error) {
      console.error(`Error adding liquidity:`, error);
    }
  }
  
  console.log("\nLiquidity addition complete!");
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
