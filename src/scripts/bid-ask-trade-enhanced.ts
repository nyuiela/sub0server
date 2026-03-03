/**
 * Enhanced live trading script: Backend API + Direct CRE with private key support.
 *
 * Usage (Backend API - existing):
 *   pn tsx src/scripts/bid-ask-trade-enhanced.ts <marketId1> [marketId2] ...
 *
 * Usage (Direct CRE - NEW):
 *   pn tsx src/scripts/bid-ask-trade-enhanced.ts --cre <marketId1> [marketId2] ...
 *   pn bid-ask-trade-enhanced --cre --continuous [marketId1] ...
 *
 * Env for CRE mode:
 *   CRE_PRIVATE_KEY (required): Private key for signing transactions
 *   CRE_HTTP_URL (required): CRE gateway URL (e.g., http://localhost:8080)
 *   CRE_HTTP_API_KEY (optional): API key for CRE gateway
 *
 * Env for Backend mode (existing):
 *   API_KEY, BASE_URL, etc.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createWalletClient, http, parseEther, formatEther, createPublicClient } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

function loadEnv(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

// Configuration
const BACKEND_PORT = process.env.PORT ?? "4000";
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${BACKEND_PORT}`;
const API_KEY = process.env.API_KEY ?? "";
const INTERVAL_MS = Math.max(50000, Number(process.env.BID_ASK_TRADE_INTERVAL_MS) || 60_000);
const MARKETS_LIMIT = Math.max(1, Math.min(50, Number(process.env.BID_ASK_TRADE_MARKETS_LIMIT) || 10));
const ORDER_DELAY_MS = Math.max(0, Number(process.env.BID_ASK_TRADE_ORDER_DELAY_MS) || 1000);

// CRE Configuration
const CRE_PRIVATE_KEY = process.env.CRE_PRIVATE_KEY;
const CRE_HTTP_URL = process.env.CRE_HTTP_URL;
const CRE_HTTP_API_KEY = process.env.CRE_HTTP_API_KEY ?? "";

let shutdown = false;

function log(msg: string, level: "info" | "ok" | "fail" = "info"): void {
  const prefix = level === "ok" ? "[OK] " : level === "fail" ? "[FAIL] " : "";
  console.log(`${prefix}${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// Backend API functions (existing)
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

// CRE Direct functions (NEW)
async function callCre(action: string, payload: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  if (!CRE_HTTP_URL) return { ok: false, error: "CRE_HTTP_URL not set" };

  const body: Record<string, unknown> = { action, ...payload };
  if (CRE_HTTP_API_KEY) (body as any).apiKey = CRE_HTTP_API_KEY;

  try {
    const res = await fetch(CRE_HTTP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `CRE ${res.status}: ${text.slice(0, 200)}` };
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: "CRE response not JSON" };
    }
    return { ok: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// Get nonce for account
async function getNonce(address: string): Promise<number> {
  if (!CRE_PRIVATE_KEY) throw new Error("CRE_PRIVATE_KEY not set");

  const account = privateKeyToAccount(CRE_PRIVATE_KEY as `0x${string}`);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(),
  });

  const nonce = await publicClient.getTransactionCount({ address: account.address });
  return nonce;
}

// Get latest transaction hash for account
async function getLatestTransactionHash(address: string): Promise<string | null> {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(),
  });

  try {
    const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
    const txs = await publicClient.getBlock({
      blockNumber: latestBlock.number,
      includeTransactions: true
    });

    // Find the most recent transaction from our address
    for (let i = txs.transactions.length - 1; i >= 0; i--) {
      const tx = txs.transactions[i];
      if (tx.from.toLowerCase() === address.toLowerCase()) {
        return tx.hash;
      }
    }
    return null;
  } catch (error) {
    console.error("Error getting latest transaction:", error);
    return null;
  }
}

// Get balance for account
async function getBalance(tokenAddress: string, accountAddress: string): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(),
  });

  if (tokenAddress === "0x0000000000000000000000000000000000000000") {
    // ETH balance
    return await publicClient.getBalance({ address: accountAddress as `0x${string}` });
  } else {
    // ERC20 balance
    return await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: [{ "constant": true, "inputs": [{ "name": "_owner", "type": "address" }], "name": "balanceOf", "outputs": [{ "name": "balance", "type": "uint256" }], "type": "function" }],
      functionName: "balanceOf",
      args: [accountAddress]
    }) as bigint;
  }
}

// Place order via CRE (NEW)
async function placeCreOrder(params: {
  questionId: string;
  conditionId: string;
  outcomeIndex: number;
  buy: boolean;
  quantity: string;
  maxCostUsdc: string;
}): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const nonce = await getNonce(params.questionId);
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  const result = await callCre("order", {
    questionId: params.questionId,
    conditionId: params.conditionId,
    outcomeIndex: params.outcomeIndex,
    buy: params.buy,
    quantity: params.quantity,
    tradeCostUsdc: params.maxCostUsdc,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
  });

  if (!result.ok) return { ok: false, error: result.error };

  // Extract txHash from CRE response if available
  const data = result.data as any;
  const txHash = data?.txHash || data?.transactionHash || "";

  return { ok: true, txHash: txHash || undefined };
}

// Place market order via CRE (NEW)
async function placeCreMarketOrder(params: {
  questionId: string;
  conditionId: string;
  outcomeIndex: number;
  buy: boolean;
  quantity: string;
  maxCostUsdc: string;
}): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const nonce = await getNonce(params.questionId);
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  const action = params.buy ? "buy" : "sell";
  const result = await callCre(action, {
    questionId: params.questionId,
    conditionId: params.conditionId,
    outcomeIndex: params.outcomeIndex,
    buy: params.buy,
    quantity: params.quantity,
    tradeCostUsdc: params.maxCostUsdc,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
  });

  if (!result.ok) return { ok: false, error: result.error };

  // Extract txHash from CRE response if available
  const data = result.data as any;
  const txHash = data?.txHash || data?.transactionHash || "";

  return { ok: true, txHash: txHash || undefined };
}

function parseArgs(): { cre: boolean; continuous: boolean; marketIds: string[]; broadcast: boolean } {
  const args = process.argv.slice(2);
  let cre = false;
  let continuous = false;
  let broadcast = false;
  const marketIds: string[] = [];
  for (const a of args) {
    if (a === "--cre") cre = true;
    else if (a === "--continuous" || a === "-c") continuous = true;
    else if (a === "--broadcast") broadcast = true;
    else if (a.length > 0 && !a.startsWith("-")) marketIds.push(a);
  }
  return { cre, continuous, marketIds, broadcast };
}

async function fetchOpenMarkets(): Promise<string[]> {
  const { status, data } = await fetchApi(`/api/markets?status=OPEN&limit=${MARKETS_LIMIT}`);
  if (status !== 200) return [];
  const list = data as { data?: { id?: string }[] };
  const items = list.data ?? [];
  return items.map((m) => m.id).filter((id): id is string => typeof id === "string");
}

async function getMarket(marketId: string): Promise<{ name?: string; outcomes?: unknown[]; questionId?: string; conditionId?: string } | null> {
  const { status, data } = await fetchApi(`/api/markets/${marketId}`);
  if (status !== 200) return null;
  return data as { name?: string; outcomes?: unknown[]; questionId?: string; conditionId?: string };
}

// Backend order placement (existing)
async function placeBackendOrder(params: {
  marketId: string;
  outcomeIndex: number;
  side: "BID" | "ASK";
  type: "LIMIT" | "MARKET";
  price?: string;
  quantity: string;
}): Promise<{ status: number; data: unknown }> {
  const body: Record<string, unknown> = {
    marketId: params.marketId,
    outcomeIndex: params.outcomeIndex,
    side: params.side,
    type: params.type,
    quantity: params.quantity,
  };
  if (params.type === "LIMIT" && params.price != null) body.price = params.price;
  return fetchApi("/api/orders", { method: "POST", body });
}

// Enhanced runMarket supporting both Backend and CRE
async function runMarket(marketId: string, useCre: boolean): Promise<boolean> {
  log(`\n--- Market ${marketId} (${useCre ? "CRE" : "Backend"}) ---`, "info");

  let market: { name?: string; outcomes?: unknown[]; questionId?: string; conditionId?: string } | null = null;
  let questionId: string;
  let conditionId: string = "0x0000000000000000000000000000000000000000000000000000000000000000";

  if (useCre) {
    // For CRE mode, if marketId looks like a questionId (starts with 0x and 66 chars), use it directly
    if (marketId.startsWith("0x") && marketId.length === 66) {
      questionId = marketId;
      // Get market details from backend using questionId
      const { status, data } = await fetchApi(`/api/markets?questionId=${questionId}&limit=1`);
      if (status === 200 && data) {
        const list = data as { data?: { id?: string; name?: string; outcomes?: unknown[]; conditionId?: string }[] };
        const items = list.data ?? [];
        if (items.length > 0) {
          market = items[0];
          conditionId = market.conditionId ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
        }
      }
    } else {
      // Try to get market by backend ID
      market = await getMarket(marketId);
      questionId = market?.questionId ?? marketId;
      conditionId = market?.conditionId ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
    }

    // If still no market found, create minimal info for CRE trading
    if (!market) {
      market = { name: `CRE Market ${questionId.slice(0, 10)}...`, outcomes: [{}, {}] };
      conditionId = "0x0000000000000000000000000000000000000000000000000000000000000000";
    }
  } else {
    // Backend mode - get market by backend ID
    market = await getMarket(marketId);
    if (!market) {
      log(`Market not found: ${marketId}`, "fail");
      return false;
    }
    questionId = market.questionId ?? marketId;
    conditionId = market.conditionId ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
  }

  const name = market.name ?? marketId;
  const outcomeCount = Array.isArray(market.outcomes) ? market.outcomes.length : 2;

  log(`Market: ${name} (outcomes: ${outcomeCount})`, "info");
  log(`QuestionId: ${questionId}`, "info");
  log(`ConditionId: ${conditionId}`, "info");

  const outcomeIndex = 0;

  if (useCre) {
    // CRE Direct Trading
    if (!CRE_PRIVATE_KEY || !CRE_HTTP_URL) {
      log("CRE mode requires CRE_PRIVATE_KEY and CRE_HTTP_URL", "fail");
      return false;
    }

    // Check balances before trading
    const account = privateKeyToAccount(CRE_PRIVATE_KEY as `0x${string}`);
    const usdcAddress = "0xeF536e7Dc524566635Ae50E891BFC44d6619a1FF";
    const ethBalance = await getBalance("0x0000000000000000000000000000000000000000", account.address);
    const usdcBalance = await getBalance(usdcAddress, account.address);

    log(`Account: ${account.address}`, "info");
    log(`ETH Balance: ${formatEther(ethBalance)} ETH`, "info");
    log(`USDC Balance: ${formatEther(usdcBalance)} USDC`, "info");

    if (usdcBalance < 1000000n) { // Less than 1 USDC (6 decimals)
      log("Insufficient USDC balance for trading", "fail");
      return false;
    }

    log("Placing CRE BID order (buy=true)...", "info");
    const bidRes = await placeCreOrder({
      questionId,
      conditionId,
      outcomeIndex,
      buy: true,
      quantity: "1000000000000000000", // 1 ETH
      maxCostUsdc: "400000", // 0.4 USDC
    });
    if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
    if (!bidRes.ok) {
      log(`CRE BID failed: ${bidRes.error}`, "fail");
      return false;
    }

    // Get real txHash from blockchain
    let realTxHash = bidRes.txHash;
    if (!realTxHash && CRE_PRIVATE_KEY) {
      const account = privateKeyToAccount(CRE_PRIVATE_KEY as `0x${string}`);
      await sleep(3000); // Wait longer for transaction to be mined
      const latestTxHash = await getLatestTransactionHash(account.address);
      realTxHash = latestTxHash || undefined;
    }
    log(`CRE BID placed txHash=${realTxHash ?? "?"}`, "ok");

    log("Placing CRE ASK order (buy=false)...", "info");
    const askRes = await placeCreOrder({
      questionId,
      conditionId,
      outcomeIndex,
      buy: false,
      quantity: "300000000000000000", // 0.3 ETH
      maxCostUsdc: "150000", // 0.15 USDC
    });
    if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
    if (!askRes.ok) {
      log(`CRE ASK failed: ${askRes.error}`, "fail");
      return false;
    }

    // Get real txHash from blockchain
    realTxHash = askRes.txHash;
    if (!realTxHash && CRE_PRIVATE_KEY) {
      const account = privateKeyToAccount(CRE_PRIVATE_KEY as `0x${string}`);
      await sleep(3000); // Wait longer for transaction to be mined
      const latestTxHash = await getLatestTransactionHash(account.address);
      realTxHash = latestTxHash || undefined;
    }
    log(`CRE ASK placed txHash=${realTxHash ?? "?"}`, "ok");

    // Test market order
    log("Placing CRE MARKET BUY order...", "info");
    const marketRes = await placeCreMarketOrder({
      questionId,
      conditionId,
      outcomeIndex,
      buy: true,
      quantity: "500000000000000000", // 0.5 ETH
      maxCostUsdc: "250000", // 0.25 USDC
    });
    if (!marketRes.ok) {
      log(`CRE MARKET failed: ${marketRes.error}`, "fail");
      return false;
    }

    // Get real txHash from blockchain
    realTxHash = marketRes.txHash;
    if (!realTxHash && CRE_PRIVATE_KEY) {
      const account = privateKeyToAccount(CRE_PRIVATE_KEY as `0x${string}`);
      await sleep(3000); // Wait longer for transaction to be mined
      const latestTxHash = await getLatestTransactionHash(account.address);
      realTxHash = latestTxHash || undefined;
    }
    log(`CRE MARKET placed txHash=${realTxHash ?? "?"}`, "ok");

  } else {
    // Backend API Trading (existing)
    log("Placing Backend LIMIT BID @ 0.40 qty 50...", "info");
    const bidRes = await placeBackendOrder({
      marketId,
      outcomeIndex,
      side: "BID",
      type: "LIMIT",
      price: "0.4",
      quantity: "50",
    });
    if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
    if (bidRes.status !== 201) {
      log(`Backend BID failed ${bidRes.status}: ${JSON.stringify(bidRes.data)}`, "fail");
      return false;
    }
    const bidData = bidRes.data as { orderId?: string; status?: string; trades?: unknown[] };
    log(`Backend BID placed orderId=${bidData.orderId ?? "?"} status=${bidData.status ?? "?"} trades=${(bidData.trades ?? []).length}`, "ok");

    log("Placing Backend LIMIT ASK @ 0.50 qty 30...", "info");
    const askRes = await placeBackendOrder({
      marketId,
      outcomeIndex,
      side: "ASK",
      type: "LIMIT",
      price: "0.5",
      quantity: "30",
    });
    if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
    if (askRes.status !== 201) {
      log(`Backend ASK failed ${askRes.status}: ${JSON.stringify(askRes.data)}`, "fail");
      return false;
    }
    const askData = askRes.data as { orderId?: string; status?: string; trades?: unknown[] };
    log(`Backend ASK placed orderId=${askData.orderId ?? "?"} status=${askData.status ?? "?"} trades=${(askData.trades ?? []).length}`, "ok");
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

async function runCycle(marketIds: string[], cycleIndex: number, useCre: boolean, broadcast: boolean = false): Promise<number> {
  if (marketIds.length === 0) return 0;
  log(`\n[Cycle ${cycleIndex}] ${marketIds.length} market(s) via ${useCre ? "CRE" : "Backend"}${broadcast ? " + BROADCAST" : ""}`, "info");
  let okCount = 0;
  for (const marketId of marketIds) {
    if (shutdown) break;
    const ok = await runMarket(marketId, useCre);
    if (ok) okCount++;
  }
  return okCount;
}

async function main(): Promise<void> {
  const { cre, continuous, marketIds: cliMarketIds, broadcast } = parseArgs();

  if (!continuous && cliMarketIds.length === 0) {
    console.log("Usage:");
    console.log("  Backend API:  pn bid-ask-trade-enhanced <marketId1> [marketId2] ...");
    console.log("  CRE Direct:   pn bid-ask-trade-enhanced --cre <marketId1> [marketId2] ...");
    console.log("  Continuous:   pn bid-ask-trade-enhanced --continuous [marketId1] ...");
    console.log("  CRE Continuous: pn bid-ask-trade-enhanced --cre --continuous [marketId1] ...");
    console.log("  Broadcast:    Add --broadcast for real transactions");
    console.log("");
    console.log("Env for Backend: API_KEY, BASE_URL, etc.");
    console.log("Env for CRE: CRE_PRIVATE_KEY, CRE_HTTP_URL, CRE_HTTP_API_KEY");
    process.exit(1);
  }

  console.log(`Enhanced Bid/Ask/Trade live test (${cre ? "CRE Direct" : "Backend API"}${broadcast ? " + BROADCAST" : ""})`);

  if (cre) {
    console.log(`CRE_HTTP_URL=${CRE_HTTP_URL ?? "(not set)"}`);
    console.log(`CRE_PRIVATE_KEY=${CRE_PRIVATE_KEY ? "***" : "(not set)"}`);
    if (!CRE_PRIVATE_KEY || !CRE_HTTP_URL) {
      log("CRE mode requires CRE_PRIVATE_KEY and CRE_HTTP_URL", "fail");
      process.exit(1);
    }
  } else {
    console.log(`BASE_URL=${BASE_URL}`);
    console.log(`API_KEY=${API_KEY ? "***" : "(not set)"}`);
    if (!API_KEY) {
      log("Backend mode requires API_KEY", "fail");
      process.exit(1);
    }
  }

  if (continuous) {
    console.log(`Mode: continuous (interval ${INTERVAL_MS}ms, order delay ${ORDER_DELAY_MS}ms)`);
    console.log(`Markets: ${cliMarketIds.length > 0 ? cliMarketIds.join(", ") : `discover OPEN (limit ${MARKETS_LIMIT})`}`);
    setupShutdown();
  } else {
    console.log(`Markets: ${cliMarketIds.length} (${cliMarketIds.join(", ")})`);
  }

  if (!continuous) {
    const okCount = await runCycle(cliMarketIds, 1, cre, broadcast);
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
      await runCycle(marketIds, cycleIndex, cre, broadcast);
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
