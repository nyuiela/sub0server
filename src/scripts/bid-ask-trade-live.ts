/**
 * Live test script: bid, ask, and trade on one or more markets.
 *
 * Usage (one-shot):
 *   pn tsx src/scripts/bid-ask-trade-live.ts <marketId1> [marketId2] ...
 *   pn bid-ask-trade-live <marketId1> [marketId2] ...
 *
 * Usage (continuous, autonomous):
 *   pn bid-ask-trade-live --continuous [marketId1] [marketId2] ...
 *   pn bid-ask-trade-live -c
 * With no market IDs in continuous mode, fetches OPEN markets each cycle (GET /api/markets?status=OPEN).
 *
 * Env (optional): BID_ASK_TRADE_INTERVAL_MS (delay between cycles, default 60000),
 *   BID_ASK_TRADE_MARKETS_LIMIT (max markets per cycle when discovering, default 10),
 *   BID_ASK_TRADE_ORDER_DELAY_MS (delay between orders in same market, default 500).
 *
 * Requires: Backend running, API_KEY in .env (or set). Markets must exist and be OPEN.
 * For each market: places a LIMIT BID, LIMIT ASK, then a signed MARKET BID.
 * Decryption uses the same dotenv + agent-keys.service as agent-trading-simulation (AGENT_ENCRYPTION_SECRET or JWT_SECRET).
 */

// Load environment first, same as agent-trading-simulation, so AGENT_ENCRYPTION_SECRET/JWT_SECRET is correct for decryption
import { config } from "dotenv";
config();

import { createRequire } from "module";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { getPrismaClient } from "../lib/prisma.js";
import { decryptPrivateKey } from "../services/agent-keys.service.js";
import { buildUserTradeTypedData } from "../lib/signature.js";
import { CHAIN_KEY_MAIN } from "../types/agent-chain.js";

const require = createRequire(import.meta.url);
const contracts = require("../lib/contracts.json") as {
  chainRpcUrl?: string;
  contracts?: { usdc?: string; conditionalTokens?: string; predictionVault?: string };
};
const RPC_URL = process.env.CHAIN_RPC_URL || contracts.chainRpcUrl || "https://sepolia.drpc.org";
const USDC_ADDRESS = contracts.contracts?.usdc as string | undefined;
const CT_ADDRESS = contracts.contracts?.conditionalTokens as string | undefined;
const PREDICTION_VAULT_ADDRESS = contracts.contracts?.predictionVault as string | undefined;

const MAX_U256 = 2n ** 256n - 1n;

const ERC20_ALLOWANCE_APPROVE_ABI = [
  {
    type: "function" as const,
    name: "allowance",
    inputs: [
      { name: "owner", type: "address", internalType: "address" },
      { name: "spender", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view" as const,
  },
  {
    type: "function" as const,
    name: "approve",
    inputs: [
      { name: "spender", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable" as const,
  },
] as const;

const ERC1155_APPROVAL_ABI = [
  {
    type: "function" as const,
    name: "isApprovedForAll",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      { name: "operator", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view" as const,
  },
  {
    type: "function" as const,
    name: "setApprovalForAll",
    inputs: [
      { name: "operator", type: "address", internalType: "address" },
      { name: "approved", type: "bool", internalType: "bool" },
    ],
    outputs: [],
    stateMutability: "nonpayable" as const,
  },
] as const;

const BACKEND_PORT = process.env.PORT ?? "4000";
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${BACKEND_PORT}`;
const API_KEY = process.env.API_KEY ?? "";
const AGENT_ID = process.env.BID_ASK_TRADE_AGENT_ID ?? process.env.AGENT_ID ?? "";
const INTERVAL_MS = Math.max(50000, Number(process.env.BID_ASK_TRADE_INTERVAL_MS) || 60_000);
const MARKETS_LIMIT = Math.max(1, Math.min(50, Number(process.env.BID_ASK_TRADE_MARKETS_LIMIT) || 10));
const ORDER_DELAY_MS = Math.max(0, Number(process.env.BID_ASK_TRADE_ORDER_DELAY_MS) || 100000);
const DEFAULT_OUTCOME_INDEX = 0;
const LIMIT_PRICE = "0.45";
const LIMIT_BID_QTY_USDC_6 = "50000000";
const LIMIT_ASK_QTY_USDC_6 = "30000000";
const MARKET_BID_QTY_USDC_6 = "20000000";

let shutdown = false;
const prisma = getPrismaClient();

interface MarketSummary {
  id?: string;
}

interface MarketsResponse {
  data?: MarketSummary[];
}

interface MarketDetailResponse {
  id?: string;
  name?: string | null;
  outcomes?: unknown[];
  questionId?: string | null;
  conditionId?: string | null;
}

interface AgentSigningIdentity {
  id: string;
  name: string | null;
  walletAddress: string | null;
  encryptedPrivateKey: string | null;
}

interface SignedTradeQuote {
  userSignature: string;
  tradeCostUsdc: string;
  nonce: string;
  deadline: string;
}

interface OrderApiResponse {
  orderId?: string;
  status?: string;
  trades?: Array<{ price?: string; quantity?: string }>;
  txHash?: string;
}

function isQuestionIdFormat(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function log(msg: string, level: "info" | "ok" | "fail" = "info"): void {
  const prefix = level === "ok" ? "[OK] " : level === "fail" ? "[FAIL] " : "";
  console.log(`${prefix}${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchApi(
  path: string,
  options: { method?: string; body?: object; headers?: Record<string, string> } = {}
): Promise<{ status: number; data: unknown }> {
  const url = `${BASE_URL.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    ...options.headers,
  };
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data: unknown;
  const ct = res.headers.get("content-type");
  if (ct?.includes("application/json")) {
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
  } else {
    data = await res.text();
  }
  return { status: res.status, data };
}

function parseArgs(): { continuous: boolean; marketIds: string[] } {
  const args = process.argv.slice(2);
  let continuous = false;
  const marketIds: string[] = [];
  for (const a of args) {
    if (a === "--continuous" || a === "-c") continuous = true;
    else if (a.length > 0 && !a.startsWith("-")) marketIds.push(a);
  }
  return { continuous, marketIds };
}

async function fetchOpenMarkets(): Promise<string[]> {
  const { status, data } = await fetchApi(`/api/markets?status=OPEN&limit=${MARKETS_LIMIT}`);
  if (status !== 200) return [];
  const list = data as MarketsResponse;
  const items = list.data ?? [];
  return items.map((m) => m.id).filter((id): id is string => typeof id === "string");
}

async function getMarket(marketId: string): Promise<MarketDetailResponse | null> {
  const { status, data } = await fetchApi(`/api/markets/${marketId}`);
  if (status !== 200) return null;
  return data as MarketDetailResponse;
}

async function getAgentIdentity(): Promise<AgentSigningIdentity | null> {
  if (AGENT_ID) {
    const agent = await prisma.agent.findUnique({
      where: { id: AGENT_ID },
      select: {
        id: true,
        name: true,
        walletAddress: true,
        encryptedPrivateKey: true,
      },
    });
    return agent;
  }

  const agent = await prisma.agent.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      walletAddress: true,
      encryptedPrivateKey: true,
    },
  });
  return agent;
}

function hasCompleteWallet(agent: AgentSigningIdentity): boolean {
  const walletAddress = agent.walletAddress?.trim();
  const encryptedPrivateKey = agent.encryptedPrivateKey?.trim();
  return Boolean(walletAddress && encryptedPrivateKey);
}

/**
 * Check ERC20 (USDC) allowance and ERC1155 (CT) approval for the agent toward the prediction vault.
 * If not allowed, send approve / setApprovalForAll and wait for receipts, then proceed.
 */
async function ensureAllowance(agent: AgentSigningIdentity): Promise<boolean> {
  if (!USDC_ADDRESS || !CT_ADDRESS || !PREDICTION_VAULT_ADDRESS) {
    log("Missing USDC, CT or predictionVault address; skipping allowance check", "fail");
    return false;
  }
  if (!agent.walletAddress?.trim() || !agent.encryptedPrivateKey?.trim()) {
    return false;
  }
  let privateKey: string;
  try {
    privateKey = decryptPrivateKey(agent.encryptedPrivateKey);
  } catch (e) {
    log(`Allowance check: could not decrypt agent key: ${e instanceof Error ? e.message : String(e)}`, "fail");
    return false;
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC_URL),
  });
  const owner = agent.walletAddress as Hex;
  const spender = PREDICTION_VAULT_ADDRESS as Hex;

  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS as Hex,
    abi: ERC20_ALLOWANCE_APPROVE_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance < MAX_U256) {
    log("ERC20 allowance insufficient; sending approve(max)...", "info");
    try {
      const hash = await walletClient.writeContract({
        address: USDC_ADDRESS as Hex,
        abi: ERC20_ALLOWANCE_APPROVE_ABI,
        functionName: "approve",
        args: [spender, MAX_U256],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      log(`USDC approve confirmed (tx ${hash.slice(0, 10)}...)`, "ok");
    } catch (e) {
      log(`USDC approve failed: ${e instanceof Error ? e.message : String(e)}`, "fail");
      return false;
    }
  }

  const isApproved = await publicClient.readContract({
    address: CT_ADDRESS as Hex,
    abi: ERC1155_APPROVAL_ABI,
    functionName: "isApprovedForAll",
    args: [owner, spender],
  });
  if (!isApproved) {
    log("ERC1155 not approved for vault; sending setApprovalForAll(true)...", "info");
    try {
      const hash = await walletClient.writeContract({
        address: CT_ADDRESS as Hex,
        abi: ERC1155_APPROVAL_ABI,
        functionName: "setApprovalForAll",
        args: [spender, true],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      log(`CT setApprovalForAll confirmed (tx ${hash.slice(0, 10)}...)`, "ok");
    } catch (e) {
      log(`CT setApprovalForAll failed: ${e instanceof Error ? e.message : String(e)}`, "fail");
      return false;
    }
  }

  return true;
}

async function signMarketOrder(params: {
  agent: AgentSigningIdentity;
  questionId: string;
  outcomeIndex: number;
  side: "BID" | "ASK";
  quantity: string;
  maxCostUsdc: string;
}): Promise<SignedTradeQuote | null> {
  try {
    if (!params.agent.encryptedPrivateKey?.trim() || !params.agent.walletAddress?.trim()) return null;

    const decryptedPrivateKey = decryptPrivateKey(params.agent.encryptedPrivateKey);
    const account = privateKeyToAccount(decryptedPrivateKey as `0x${string}`);
    if (account.address.toLowerCase() !== params.agent.walletAddress.toLowerCase()) {
      log(
        `Agent wallet mismatch: derived ${account.address} vs stored ${params.agent.walletAddress}`,
        "fail"
      );
      return null;
    }

    const nonce = BigInt(Date.now()).toString();
    const deadline = String(Math.floor(Date.now() / 1000) + 300);
    const typedData = buildUserTradeTypedData({
      questionId: params.questionId,
      outcomeIndex: params.outcomeIndex,
      buy: params.side === "BID",
      quantity: params.quantity,
      maxCostUsdc: params.maxCostUsdc,
      nonce,
      deadline: Number(deadline),
    });

    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(process.env.CHAIN_RPC_URL || "https://sepolia.drpc.org"),
    });
    const userSignature = await walletClient.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    return {
      userSignature,
      tradeCostUsdc: params.maxCostUsdc,
      nonce,
      deadline,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("unable to authenticate data")) {
      log(
        "Failed to decrypt agent private key (auth mismatch). Check AGENT_ENCRYPTION_SECRET/JWT_SECRET matches the one used when this agent wallet was created.",
        "fail"
      );
    } else {
      log(`Failed to sign market order: ${message}`, "fail");
    }
    return null;
  }
}

async function placeOrder(params: {
  agentId: string;
  marketId: string;
  outcomeIndex: number;
  side: "BID" | "ASK";
  type: "LIMIT" | "MARKET";
  price?: string;
  quantity: string;
  signedQuote?: SignedTradeQuote;
}): Promise<{ status: number; data: unknown }> {
  const body: Record<string, unknown> = {
    agentId: params.agentId,
    marketId: params.marketId,
    outcomeIndex: params.outcomeIndex,
    side: params.side,
    type: params.type,
    quantity: params.quantity,
    chainKey: CHAIN_KEY_MAIN,
  };
  if (params.type === "LIMIT" && params.price != null) body.price = params.price;
  if (params.type === "MARKET" && params.signedQuote) {
    body.userSignature = params.signedQuote.userSignature;
    body.tradeCostUsdc = params.signedQuote.tradeCostUsdc;
    body.nonce = params.signedQuote.nonce;
    body.deadline = params.signedQuote.deadline;
  }
  return fetchApi("/api/orders", { method: "POST", body });
}

async function runMarket(marketId: string, agent: AgentSigningIdentity): Promise<boolean> {
  log(`\n--- Market ${marketId} ---`, "info");

  const market = await getMarket(marketId);
  if (!market) {
    log(`Market not found: ${marketId}`, "fail");
    return false;
  }
  const name = market.name ?? marketId;
  const outcomeCount = Array.isArray(market.outcomes) ? market.outcomes.length : 2;
  log(`Market: ${name} (outcomes: ${outcomeCount})`, "info");

  const apiQuestionId = market.questionId?.trim();
  const questionId =
    apiQuestionId && apiQuestionId.length > 0
      ? apiQuestionId
      : isQuestionIdFormat(marketId)
        ? marketId
        : "";
  if (!questionId) {
    log(
      `Market ${marketId} has no questionId in API response and input is not a questionId; cannot sign market trade`,
      "fail"
    );
    return false;
  }

  const outcomeIndex = DEFAULT_OUTCOME_INDEX;

  const allowanceOk = await ensureAllowance(agent);
  if (!allowanceOk) {
    log("Allowance check/approve failed; skipping market", "fail");
    return false;
  }

  log(`Placing LIMIT BID @ ${LIMIT_PRICE} qty 50 (agent liquidity)...`, "info");
  const bidRes = await placeOrder({
    agentId: agent.id,
    marketId,
    outcomeIndex,
    side: "BID",
    type: "LIMIT",
    price: LIMIT_PRICE,
    quantity: LIMIT_BID_QTY_USDC_6,
  });
  if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
  if (bidRes.status !== 201) {
    log(`BID failed ${bidRes.status}: ${JSON.stringify(bidRes.data)}`, "fail");
    return false;
  }
  const bidData = bidRes.data as OrderApiResponse;
  log(`BID placed orderId=${bidData.orderId ?? "?"} status=${bidData.status ?? "?"} trades=${(bidData.trades ?? []).length}`, "ok");

  log(`Placing LIMIT ASK @ ${LIMIT_PRICE} qty 30 (agent liquidity)...`, "info");
  const askRes = await placeOrder({
    agentId: agent.id,
    marketId,
    outcomeIndex,
    side: "ASK",
    type: "LIMIT",
    price: LIMIT_PRICE,
    quantity: LIMIT_ASK_QTY_USDC_6,
  });
  if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
  if (askRes.status !== 201) {
    log(`ASK failed ${askRes.status}: ${JSON.stringify(askRes.data)}`, "fail");
    return false;
  }
  const askData = askRes.data as OrderApiResponse;
  log(`ASK placed orderId=${askData.orderId ?? "?"} status=${askData.status ?? "?"} trades=${(askData.trades ?? []).length}`, "ok");

  log("Signing and placing MARKET BID qty 20...", "info");
  const signedQuote = await signMarketOrder({
    agent,
    questionId,
    outcomeIndex,
    side: "BID",
    quantity: MARKET_BID_QTY_USDC_6,
    maxCostUsdc: MARKET_BID_QTY_USDC_6,
  });
  if (!signedQuote) {
    log("Could not sign market order; skipping market trade", "fail");
    return false;
  }

  if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
  const marketRes = await placeOrder({
    agentId: agent.id,
    marketId,
    outcomeIndex,
    side: "BID",
    type: "MARKET",
    quantity: MARKET_BID_QTY_USDC_6,
    signedQuote,
  });
  if (marketRes.status !== 201) {
    log(`MARKET BID failed ${marketRes.status}: ${JSON.stringify(marketRes.data)}`, "fail");
    return true;
  }
  const marketData = marketRes.data as OrderApiResponse;
  const trades = marketData.trades ?? [];
  log(
    `MARKET BID placed orderId=${marketData.orderId ?? "?"} status=${marketData.status ?? "?"} trades=${trades.length} txHash=${marketData.txHash ?? "?"}`,
    "ok"
  );
  if (trades.length > 0) {
    trades.forEach((t, i) => log(`  trade ${i + 1}: price=${t.price} qty=${t.quantity}`, "info"));
  }

  return true;
}

function setupShutdown(): void {
  const onSignal = (): void => {
    if (shutdown) process.exit(0);
    shutdown = true;
    log("Shutting down after this cycle (Ctrl+C again to exit now)...", "info");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

async function runCycle(marketIds: string[], cycleIndex: number): Promise<number> {
  if (marketIds.length === 0) return 0;
  log(`\n[Cycle ${cycleIndex}] ${marketIds.length} market(s)`, "info");

  const agent = await getAgentIdentity();
  if (!agent) {
    log("No agent found. Set BID_ASK_TRADE_AGENT_ID or create at least one agent.", "fail");
    return 0;
  }
  if (!hasCompleteWallet(agent)) {
    log(`Agent ${agent.id} has incomplete wallet data; cannot sign market orders`, "fail");
    return 0;
  }
  log(`Using agent ${agent.name ?? agent.id} (${agent.id})`, "info");

  let okCount = 0;
  for (const marketId of marketIds) {
    if (shutdown) break;
    const ok = await runMarket(marketId, agent);
    if (ok) okCount++;
  }
  return okCount;
}

async function main(): Promise<void> {
  const { continuous, marketIds: cliMarketIds } = parseArgs();

  if (!continuous && cliMarketIds.length === 0) {
    console.log("Usage:");
    console.log("  One-shot:  pn bid-ask-trade-live <marketId1> [marketId2] ...");
    console.log("  Continuous: pn bid-ask-trade-live --continuous [marketId1] ...");
    console.log("  Continuous (discover OPEN markets): pn bid-ask-trade-live -c");
    console.log("");
    console.log("Env: BID_ASK_TRADE_INTERVAL_MS, BID_ASK_TRADE_MARKETS_LIMIT, BID_ASK_TRADE_ORDER_DELAY_MS");
    console.log("Requires: Backend running, API_KEY in .env");
    process.exit(1);
  }

  console.log("Bid/Ask/Trade live test");
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`API_KEY=${API_KEY ? "***" : "(not set - orders will fail)"}`);
  if (continuous) {
    console.log(`Mode: continuous (interval ${INTERVAL_MS}ms, order delay ${ORDER_DELAY_MS}ms)`);
    console.log(`Markets: ${cliMarketIds.length > 0 ? cliMarketIds.join(", ") : `discover OPEN (limit ${MARKETS_LIMIT})`}`);
    setupShutdown();
  } else {
    console.log(`Markets: ${cliMarketIds.length} (${cliMarketIds.join(", ")})`);
  }

  if (!API_KEY) {
    log("Set API_KEY in .env or environment to place orders", "fail");
    process.exit(1);
  }

  if (!continuous) {
    const okCount = await runCycle(cliMarketIds, 1);
    log(`\nDone: ${okCount}/${cliMarketIds.length} markets OK`, okCount === cliMarketIds.length ? "ok" : "info");
    process.exit(okCount === cliMarketIds.length ? 0 : 1);
  }

  let cycleIndex = 0;
  while (!shutdown) {
    cycleIndex++;
    const marketIds =
      cliMarketIds.length > 0 ? cliMarketIds : await fetchOpenMarkets();
    if (marketIds.length === 0) {
      log(`[Cycle ${cycleIndex}] No OPEN markets; waiting ${INTERVAL_MS}ms...`, "info");
    } else {
      await runCycle(marketIds, cycleIndex);
    }
    if (shutdown) break;
    log(`Next cycle in ${INTERVAL_MS}ms...`, "info");
    await sleep(INTERVAL_MS);
  }

  log("Stopped.", "ok");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
