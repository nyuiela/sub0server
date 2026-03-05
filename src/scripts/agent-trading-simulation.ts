#!/usr/bin/env tsx

/**
 * Agent Trading Simulation Script - Fixed Version
 * Uses USDC for trading, proper transaction hashes, and order book verification
 * Now with EIP-712 signing for orders
 */

// Load environment variables from .env file
import { config } from "dotenv";
config();

import { config as appConfig } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { CHAIN_KEY_MAIN } from "../types/agent-chain.js";
import { runTradingAnalysis } from "../services/agent-trading-analysis.service.js";
import { sepolia } from "viem/chains";
import { createPublicClient, http, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildUserTradeTypedData } from "../lib/signature.js";
import { decryptPrivateKey } from "../services/agent-keys.service.js";

// EDIT THESE VALUES FOR YOUR SIMULATION
const AGENT_ID = "fb888532-72ca-475d-bf38-9035dadecc11"; // Change to your agent ID

const MARKET_QUESTION_IDS = [
  "0x3ea53cc69f3c990ebe65a7df09221bce0ffbb22c852b502865216a627ce5697f",
  "0x18680f5c93c53690715ced2d0cb22bef40076309b26dba8dd362e89c2c0c76f1",
  "0x56a227b3d515a0705db97829173a6a4a372c6dec19e4b83496e1cee4141636f1",
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
  userSignature?: string;
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
    userSignature: payload.userSignature
  };
  // Add userSignature if provided
  if (payload.userSignature) {
    body.userSignature = payload.userSignature;
  }
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

  /**
   * Sign an order using the agent's private key with EIP-712
   */
  private async signOrder(
    agent: {
      walletAddress: string | null;
      encryptedPrivateKey: string | null;
    },
    marketQuestionId: string,
    outcomeIndex: number,
    side: "BID" | "ASK",
    quantity: string,
    maxCostUsdc: string
  ): Promise<string | null> {
    try {
      // Check if we have the private key
      if (!agent.encryptedPrivateKey) {
        console.log("⚠️ No encrypted private key available for signing");
        return null;
      }

      // Decrypt the private key using AES-256-GCM
      const privateKey = this.decryptAgentPrivateKey(agent.encryptedPrivateKey);
      if (!privateKey) {
        console.log("⚠️ Could not decrypt private key");
        return null;
      }

      // Create wallet account from private key
      const account = privateKeyToAccount(privateKey as `0x${string}`);

      // Verify account matches agent wallet
      if (account.address.toLowerCase() !== (agent.walletAddress || "").toLowerCase()) {
        console.log(`⚠️ Account mismatch: derived ${account.address} vs agent ${agent.walletAddress}`);
        return null;
      }

      // Generate nonce and deadline
      const nonce = BigInt(Date.now());
      const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

      // Build EIP-712 typed data
      const typedData = buildUserTradeTypedData({
        questionId: marketQuestionId,
        outcomeIndex,
        buy: side === "BID",
        quantity,
        maxCostUsdc,
        nonce: nonce.toString(),
        deadline,
      });

      // Create wallet client for signing
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(process.env.CHAIN_RPC_URL || "https://sepolia.drpc.org"),
      });

      // Sign the typed data
      const signature = await walletClient.signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      console.log(`✅ Order signed with EIP-712 signature`);
      return signature;
    } catch (error) {
      console.error("❌ Failed to sign order:", error);
      return null;
    }
  }

  /**
   * Decrypt agent private key using AES-256-GCM
   */
  private decryptAgentPrivateKey(encryptedKey: string): string | null {
    try {
      return decryptPrivateKey(encryptedKey);
    } catch (error) {
      console.error("Failed to decrypt private key:", error);
      return null;
    }
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
    // Convert USDC amount to decimals (6 zeros) - AI returns "10" for 10 USDC
    const usdcAmount = Number(decision.quantity) || 10; // Default 10 USDC
    const quantity = String(usdcAmount * 1000000); // Convert to 6 decimals
    const side = decision.action === "buy" ? "BID" : "ASK";

    console.log(`Trade Parameters:`);
    console.log(`- Action: ${side}`);
    console.log(`- Outcome: ${outcomeIndex}`);
    console.log(`- Quantity: ${usdcAmount} USDC`);

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
    let preTradeBalance: string | undefined;
    let publicClient: any;
    let usdcAddress: string = "0xeF536e7Dc524566635Ae50E891BFC44d6619a1FF";

    try {
      // Get real blockchain balance by calling USDC contract
      const { createPublicClient, http } = await import("viem");
      const { CHAIN_KEY_MAIN } = await import("../types/agent-chain.js");
      const { config } = await import("../config/index.js");

      publicClient = createPublicClient({
        chain: {
          id: 11155111, // Sepolia
          name: 'Sepolia',
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: {
            default: { http: ['https://sepolia.drpc.org'] },
          },
        },
        transport: http(),
      });

      // USDC contract address from contracts.json
      usdcAddress = "0xeF536e7Dc524566635Ae50E891BFC44d6619a1FF";

      // Get real blockchain balance
      const balanceWei = await publicClient.readContract({
        address: usdcAddress as `0x${string}`,
        abi: [
          {
            name: 'balanceOf',
            type: 'function',
            stateMutability: 'view',
            inputs: [{ name: 'account', type: 'address' }],
            outputs: [{ name: 'balance', type: 'uint256' }],
          },
        ],
        functionName: 'balanceOf',
        args: [agent.walletAddress as `0x${string}`],
      });

      preTradeBalance = (balanceWei as bigint).toString();
      console.log(`Agent balance BEFORE trade (blockchain): ${Number(preTradeBalance) / 1000000} USDC`);

      if (Number(preTradeBalance) <= 10000000) { // Less than 10 USDC
        return {
          marketId: market.id,
          action: decision.action,
          reason: decision.reason,
          error: "Agent has insufficient USDC balance for trading",
        };
      }
    } catch (error) {
      console.log("Could not check agent balance, proceeding anyway");
      console.log("Balance error:", error);
    }

    // Step 8: Sign and Submit Real Order
    console.log(`Signing and submitting real order to Sepolia...`);

    // Sign the order with agent's private key
    const maxCostUsdc = quantity; // Use quantity as max cost for now
    const userSignature = await this.signOrder(
      agent,
      market.questionId,
      outcomeIndex,
      side,
      quantity,
      maxCostUsdc
    );

    if (userSignature) {
      console.log(`✅ Order signed successfully`);
      console.log(`Signature: ${userSignature.slice(0, 20)}...${userSignature.slice(-20)}`);
    } else {
      console.log(`⚠️ Could not sign order, proceeding without signature...`);
    }

    // First, ensure market has liquidity
    try {
      console.log(`Adding liquidity to market ${market.id}...`);

      const apiKey = process.env.API_KEY;
      const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";

      if (!apiKey?.trim()) {
        console.log("⚠️ API_KEY not set, skipping liquidity addition");
      } else {
        // Add BID liquidity
        const bidResponse = await fetch(`${backendUrl}/api/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            marketId: market.id,
            outcomeIndex: 0,
            side: "BID",
            type: "LIMIT",
            price: "0.45",
            quantity: "10000000", // 10 USDC
            agentId: agent.id,
          }),
        });

        // Add ASK liquidity  
        const askResponse = await fetch(`${backendUrl}/api/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            marketId: market.id,
            outcomeIndex: 0,
            side: "ASK",
            type: "LIMIT",
            price: "0.55",
            quantity: "10000000", // 10 USDC
            agentId: agent.id,
          }),
        });

        if (bidResponse.ok && askResponse.ok) {
          console.log(`✅ Liquidity added to market`);
          // Wait a moment for liquidity to be processed
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.log(`⚠️ Failed to add liquidity, proceeding anyway...`);
          console.log(`Bid result:`, bidResponse.ok ? 'SUCCESS' : 'FAILED');
          console.log(`Ask result:`, askResponse.ok ? 'SUCCESS' : 'FAILED');
          if (!bidResponse.ok) {
            const bidError = await bidResponse.text();
            console.log(`Bid error:`, bidError);
          }
          if (!askResponse.ok) {
            const askError = await askResponse.text();
            console.log(`Ask error:`, askError);
          }
        }
      }
    } catch (error) {
      console.log(`⚠️ Could not add liquidity, proceeding anyway...`);
      console.log(`Error:`, error);
    }

    const orderResult = await submitOrderFromWorker({
      agentId: agent.id,
      marketId: market.id,
      outcomeIndex,
      side,
      quantity,
      chainKey: CHAIN_KEY_MAIN,
      userSignature: userSignature || undefined,
    });

    console.log(`Order response:`, JSON.stringify(orderResult, null, 2));

    if (orderResult.ok) {
      console.log(`Order submitted successfully!`);

      // Get transaction hash from the order response
      let txHash: string | undefined;
      const orderBody = orderResult.body as any;

      // Check for transaction hash in various locations
      if (orderBody?.transactionHash) {
        txHash = orderBody.transactionHash;
      } else if (orderBody?.hash) {
        txHash = orderBody.hash;
      } else if (orderBody?.trades?.length > 0) {
        // Check in trades array for filled orders
        const trade = orderBody.trades[0];
        if (trade?.transactionHash) {
          txHash = trade.transactionHash;
        } else if (trade?.hash) {
          txHash = trade.hash;
        } else if (trade?.txHash) {
          txHash = trade.txHash;
        }
      }

      if (txHash) {
        console.log(`Transaction hash: ${txHash}`);
      } else {
        console.log(`No transaction hash found in order response`);
        console.log(`Order body keys:`, Object.keys(orderBody || {}));
        if (orderBody?.trades?.length > 0) {
          console.log(`Trade keys:`, Object.keys(orderBody.trades[0] || {}));
          console.log(`First trade details:`, JSON.stringify(orderBody.trades[0], null, 2));
        }
        txHash = "order-submitted-backend";
      }

      // Check balance after trade to see if it updated
      try {
        if (!publicClient || !usdcAddress) {
          console.log("Public client not initialized, skipping post-trade balance check");
        } else {
          // Get real blockchain balance after trade
          const balanceWeiAfter = await publicClient.readContract({
            address: usdcAddress as `0x${string}`,
            abi: [
              {
                name: 'balanceOf',
                type: 'function',
                stateMutability: 'view',
                inputs: [{ name: 'account', type: 'address' }],
                outputs: [{ name: 'balance', type: 'uint256' }],
              },
            ],
            functionName: 'balanceOf',
            args: [agent.walletAddress as `0x${string}`],
          });

          const postTradeBalance = (balanceWeiAfter as bigint).toString();
          console.log(`Agent balance AFTER trade (blockchain): ${Number(postTradeBalance) / 1000000} USDC`);
          console.log(`Balance changed: ${Number(postTradeBalance) !== Number(preTradeBalance || "0") ? 'YES' : 'NO'}`);
          console.log(`Amount deducted: ${Number(preTradeBalance || "0") - Number(postTradeBalance)} USDC`);
        }
      } catch (error) {
        console.log("Could not check post-trade balance");
        console.log("Post-trade balance error:", error);
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
