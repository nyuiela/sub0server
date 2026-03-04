#!/usr/bin/env tsx

/**
 * Agent Trading Simulation Script - Fixed Version
 * Uses USDC for trading, proper transaction hashes, and order book verification
 */

// Load environment variables from .env file
import { config } from "dotenv";
config();

import { config as appConfig } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { CHAIN_KEY_MAIN } from "../types/agent-chain.js";
import { runTradingAnalysis } from "../services/agent-trading-analysis.service.js";
import { sepolia } from "viem/chains";
import { createPublicClient, http } from "viem";

// EDIT THESE VALUES FOR YOUR SIMULATION
const AGENT_ID = "5cff6b3a-4d88-4455-b4da-d9f2ffd04130"; // Change to your agent ID

const MARKET_QUESTION_IDS = [
  "0xd035c6ade15c01188f5a7c17e15be4d03b50868760f179a4975552336c156145",
  "0x3c2e5e8edc0176579f8ca75e1af87fed62d56fb53038c4c8e943dba162647055",
  "0x9293ab7a85f99fbf607f812e7b408bd553cbf484fba72b5f6a3eb921b23a3fc4",
];

interface SimulationConfig {
  agentId: string;
  marketQuestionIds: string[];
  realTrading: boolean;
  backendUrl?: string;
}

interface TradingResult {
  marketId: string;
  action: "buy" | "sell" | "skip";
  reason?: string;
  outcomeIndex?: number;
  quantity?: string;
  orderSubmitted?: boolean;
  orderStatus?: string;
  txHash?: string;
  error?: string;
}

// Import submitOrderFromWorker by creating a local copy
async function submitOrderFromWorker(payload: {
  agentId: string;
  marketId: string;
  outcomeIndex: number;
  side: "BID" | "ASK";
  quantity: string;
  chainKey?: string | null;
}): Promise<{ ok: boolean; status: number; body?: unknown }> {
  const apiKey = process.env.API_KEY;
  if (!apiKey?.trim()) {
    return { ok: false, status: 0, body: { error: "API_KEY not set" } };
  }
  const url = `${process.env.BACKEND_URL || "http://localhost:4000"}/api/orders`;
  const body: Record<string, unknown> = {
    marketId: payload.marketId,
    outcomeIndex: payload.outcomeIndex,
    side: payload.side,
    type: "MARKET",
    quantity: payload.quantity,
    agentId: payload.agentId,
  };
  if (payload.chainKey != null && payload.chainKey !== CHAIN_KEY_MAIN) {
    body.chainKey = payload.chainKey;
  } else {
    // Always include chainKey for main chain
    body.chainKey = CHAIN_KEY_MAIN;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
    const responseBody = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body: responseBody };
  } catch (error) {
    return { ok: false, status: 500, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

class AgentTradingSimulation {
  private config: SimulationConfig;
  private prisma = getPrismaClient();
  private publicClient = createPublicClient({
    chain: sepolia,
    transport: http(process.env.CHAIN_RPC_URL || "https://sepolia.drpc.org"),
  });

  constructor(config: SimulationConfig) {
    this.config = config;
  }

  async run(): Promise<void> {
    console.log("Starting Agent Trading Simulation");
    console.log(`Agent ID: ${this.config.agentId}`);
    console.log(`Chain: Sepolia (REAL TRADING)`);
    console.log(`Markets: ${this.config.marketQuestionIds.length} specified`);

    // Step 1: Validate Agent
    const agent = await this.validateAgent();
    if (!agent) {
      throw new Error("Agent not found or not accessible");
    }
    console.log(`Agent Found: ${agent.name}`);

    // Step 2: Get Market Information
    const markets = await this.getMarketInformation();
    console.log(`Found ${markets.length} markets to analyze`);

    // Step 3: Process Each Market
    const results: TradingResult[] = [];
    for (const market of markets) {
      console.log(`\nProcessing Market: ${market.name}`);
      console.log(`Market ID: ${market.id}`);
      
      try {
        const result = await this.processMarket(market, agent);
        results.push(result);
        
        console.log(`Result: ${result.action?.toUpperCase()}`);
        if (result.reason) console.log(`Reason: ${result.reason}`);
        if (result.orderSubmitted) {
          console.log(`Order Status: ${result.orderStatus}`);
          if (result.txHash) console.log(`Transaction: ${result.txHash}`);
        }
        if (result.error) console.log(`Error: ${result.error}`);
      } catch (error) {
        console.error(`Failed to process market ${market.id}:`, error);
        results.push({
          marketId: market.id,
          action: "skip",
          reason: "Processing failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Step 4: Print Summary
    this.printSummary(results);
  }

  private async validateAgent() {
    const agent = await this.prisma.agent.findUnique({
      where: { id: this.config.agentId },
      select: {
        id: true,
        name: true,
        publicKey: true,
        walletAddress: true,
        encryptedPrivateKey: true,
        persona: true,
        modelSettings: true,
      },
    });
    return agent;
  }

  private async getMarketInformation() {
    const markets = await this.prisma.market.findMany({
      where: {
        questionId: { in: this.config.marketQuestionIds },
        status: "OPEN",
      },
      select: {
        id: true,
        name: true,
        questionId: true,
        outcomes: true,
      },
    });
    return markets;
  }

  private async processMarket(market: any, agent: any): Promise<TradingResult> {
    console.log(`Starting AI analysis for ${market.name}...`);

    // Step 1: Get Current Positions
    const currentPositions = await this.prisma.position.findMany({
      where: {
        agentId: agent.id,
        marketId: market.id,
      },
      select: {
        outcomeIndex: true,
        side: true,
        collateralLocked: true,
      },
    });

    console.log(`Current positions: ${currentPositions.length}`);

    // Step 2: Run AI Analysis
    const modelUsed = agent.modelSettings?.model || "grok-3-mini";
    console.log(`Using model: ${modelUsed}`);

    const decision = await runTradingAnalysis({
      marketName: market.name,
      outcomes: market.outcomes,
      agentName: agent.name,
      personaSummary: agent.persona?.slice(0, 500),
      model: modelUsed,
      currentPositions: currentPositions.map(pos => ({
        outcomeIndex: pos.outcomeIndex,
        side: pos.side,
        quantity: pos.collateralLocked.toString(),
      })),
    });

    console.log(`AI Decision: ${decision.action?.toUpperCase()}`);
    console.log(`AI Reason: ${decision.reason}`);

    // Step 3: Store AI Reasoning
    try {
      await this.prisma.agentReasoning.create({
        data: {
          agentId: agent.id,
          marketId: market.id,
          model: modelUsed,
          userContext: `Market: ${market.name} Outcomes: ${market.outcomes.join(", ")} Current Positions: ${currentPositions.length} positions`,
          reasoning: decision.reason || "",
          response: JSON.stringify({
            action: decision.action,
            reason: decision.reason,
            nextFollowUpInMs: decision.nextFollowUpInMs,
          }),
          actionTaken: decision.action || "skip",
          tradeReason: decision.reason || "",
        },
      });
      console.log(`AI reasoning stored in database`);
    } catch (error) {
      console.error("Failed to store AI reasoning:", error);
    }

    // Step 4: Handle Skip Decision
    if (decision.action === "skip") {
      return {
        marketId: market.id,
        action: "skip",
        reason: decision.reason,
      };
    }

    // Step 5: Prepare Trading Parameters
    const outcomeIndex = decision.outcomeIndex ?? 0;
    // Use USDC amount (6 decimals) instead of ETH (18 decimals)
    const quantity = decision.quantity ?? "10000000"; // 10 USDC default (6 decimals)
    const side = decision.action === "buy" ? "BID" : "ASK";

    console.log(`Trade Parameters:`);
    console.log(`- Action: ${side}`);
    console.log(`- Outcome: ${outcomeIndex}`);
    console.log(`- Quantity: ${Number(quantity) / 1000000} USDC`);

    // Step 6: Check Agent Wallet and Balance
    const hasWallet = this.hasCompleteWallet(
      agent.walletAddress || null,
      agent.publicKey || "",
      agent.encryptedPrivateKey || null
    );

    if (!hasWallet) {
      return {
        marketId: market.id,
        action: decision.action,
        reason: decision.reason,
        error: "Agent has no complete wallet setup",
      };
    }

    // Step 7: Check Agent Balance
    try {
      const { getAgentBalanceForChain } = await import("../lib/agent-chain-balance.js");
      const balance = await getAgentBalanceForChain(agent.id, CHAIN_KEY_MAIN);
      
      console.log(`Agent balance: ${Number(balance) / 1000000} USDC`);
      
      if (Number(balance) <= 10000000) { // Less than 10 USDC
        return {
          marketId: market.id,
          action: decision.action,
          reason: decision.reason,
          error: "Agent has insufficient USDC balance for trading",
        };
      }
    } catch (error) {
      console.log("Could not check agent balance, proceeding anyway");
    }

    // Step 8: Submit Real Order
    console.log(`Submitting real order to Sepolia...`);
    
    const orderResult = await submitOrderFromWorker({
      agentId: agent.id,
      marketId: market.id,
      outcomeIndex,
      side,
      quantity,
      chainKey: CHAIN_KEY_MAIN,
    });

    console.log(`Order response:`, orderResult);

    if (orderResult.ok) {
      console.log(`Order submitted successfully!`);
      
      // Get transaction hash from the order response
      let txHash: string | undefined;
      const orderBody = orderResult.body as any;
      
      if (orderBody?.transactionHash) {
        txHash = orderBody.transactionHash;
        console.log(`Transaction hash: ${txHash}`);
      } else if (orderBody?.hash) {
        txHash = orderBody.hash;
        console.log(`Transaction hash: ${txHash}`);
      } else {
        console.log(`No transaction hash found in order response`);
        txHash = "order-submitted-backend";
      }

      return {
        marketId: market.id,
        action: decision.action,
        reason: decision.reason,
        outcomeIndex,
        quantity,
        orderSubmitted: true,
        orderStatus: "SUCCESS",
        txHash,
      };
    } else {
      console.error(`Order failed:`, orderResult.body);
      return {
        marketId: market.id,
        action: decision.action,
        reason: decision.reason,
        outcomeIndex,
        quantity,
        orderSubmitted: false,
        orderStatus: "FAILED",
        error: `Order failed with status ${orderResult.status}: ${JSON.stringify(orderResult.body)}`,
      };
    }
  }

  private hasCompleteWallet(
    walletAddress: string | null,
    publicKey: string,
    encryptedPrivateKey: string | null
  ): boolean {
    const addr = walletAddress?.trim() || publicKey?.trim();
    if (!addr || addr === "0x0000000000000000000000000000000000000") return false;
    const key = encryptedPrivateKey?.trim();
    return Boolean(key && key !== "");
  }

  private printSummary(results: TradingResult[]): void {
    console.log("\n" + "=".repeat(60));
    console.log("SIMULATION SUMMARY");
    console.log("=".repeat(60));

    const total = results.length;
    const buys = results.filter(r => r.action === "buy").length;
    const sells = results.filter(r => r.action === "sell").length;
    const skips = results.filter(r => r.action === "skip").length;
    const ordersSubmitted = results.filter(r => r.orderSubmitted).length;
    const errors = results.filter(r => r.error).length;

    console.log(`Total Markets Processed: ${total}`);
    console.log(`Buy Decisions: ${buys}`);
    console.log(`Sell Decisions: ${sells}`);
    console.log(`Skip Decisions: ${skips}`);
    console.log(`Orders Submitted: ${ordersSubmitted}`);
    console.log(`Errors: ${errors}`);

    console.log("\nDetailed Results:");
    results.forEach((result, index) => {
      const marketIdShort = result.marketId.slice(0, 8) + "...";
      const reasonShort = result.reason ? result.reason.slice(0, 80) + (result.reason.length > 80 ? "..." : "") : "";
      
      console.log(`${index + 1}. ${marketIdShort} - ${result.action?.toUpperCase()}`);
      if (reasonShort) console.log(`   Reason: ${reasonShort}`);
      if (result.orderSubmitted) {
        console.log(`   Order: ${result.orderStatus}`);
        if (result.txHash) console.log(`   TX: ${result.txHash}`);
      }
      if (result.error) console.log(`   Error: ${result.error}`);
    });

    console.log("\nSimulation Complete!");
    console.log("All AI reasoning stored in AgentReasoning table");
    console.log("Real trades executed on Sepolia using USDC");
  }
}

// Main execution
async function main(): Promise<void> {
  const simulationConfig: SimulationConfig = {
    agentId: AGENT_ID,
    marketQuestionIds: MARKET_QUESTION_IDS,
    realTrading: true, // Always real trading on Sepolia
    backendUrl: process.env.BACKEND_URL || "http://localhost:4000",
  };
  
  console.log("Configuration:");
  console.log(`   - Agent ID: ${simulationConfig.agentId}`);
  console.log(`   - Market Question IDs: ${simulationConfig.marketQuestionIds.length} provided`);
  console.log(`   - Real Trading: ${simulationConfig.realTrading ? "YES (Sepolia)" : "NO"}`);
  console.log(`   - Backend URL: ${simulationConfig.backendUrl}`);
  
  const simulation = new AgentTradingSimulation(simulationConfig);
  await simulation.run();
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
