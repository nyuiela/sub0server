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
 * For each market: places a LIMIT BID, LIMIT ASK, then an optional crossing order to generate a trade.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

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

const BACKEND_PORT = process.env.PORT ?? "4000";
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${BACKEND_PORT}`;
const API_KEY = process.env.API_KEY ?? "";
const INTERVAL_MS = Math.max(5000, Number(process.env.BID_ASK_TRADE_INTERVAL_MS) || 60_000);
const MARKETS_LIMIT = Math.max(1, Math.min(50, Number(process.env.BID_ASK_TRADE_MARKETS_LIMIT) || 10));
const ORDER_DELAY_MS = Math.max(0, Number(process.env.BID_ASK_TRADE_ORDER_DELAY_MS) || 500);

let shutdown = false;

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
  const list = data as { data?: { id?: string }[] };
  const items = list.data ?? [];
  return items.map((m) => m.id).filter((id): id is string => typeof id === "string");
}

async function getMarket(marketId: string): Promise<{ name?: string; outcomes?: unknown[] } | null> {
  const { status, data } = await fetchApi(`/api/markets/${marketId}`);
  if (status !== 200) return null;
  return data as { name?: string; outcomes?: unknown[] };
}

async function placeOrder(params: {
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

async function runMarket(marketId: string): Promise<boolean> {
  log(`\n--- Market ${marketId} ---`, "info");

  const market = await getMarket(marketId);
  if (!market) {
    log(`Market not found: ${marketId}`, "fail");
    return false;
  }
  const name = market.name ?? marketId;
  const outcomeCount = Array.isArray(market.outcomes) ? market.outcomes.length : 2;
  log(`Market: ${name} (outcomes: ${outcomeCount})`, "info");

  const outcomeIndex = 0;

  log("Placing LIMIT BID @ 0.40 qty 50...", "info");
  const bidRes = await placeOrder({
    marketId,
    outcomeIndex,
    side: "BID",
    type: "LIMIT",
    price: "0.4",
    quantity: "50",
  });
  if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
  if (bidRes.status !== 201) {
    log(`BID failed ${bidRes.status}: ${JSON.stringify(bidRes.data)}`, "fail");
    return false;
  }
  const bidData = bidRes.data as { orderId?: string; status?: string; trades?: unknown[] };
  log(`BID placed orderId=${bidData.orderId ?? "?"} status=${bidData.status ?? "?"} trades=${(bidData.trades ?? []).length}`, "ok");

  log("Placing LIMIT ASK @ 0.50 qty 30...", "info");
  const askRes = await placeOrder({
    marketId,
    outcomeIndex,
    side: "ASK",
    type: "LIMIT",
    price: "0.5",
    quantity: "30",
  });
  if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
  if (askRes.status !== 201) {
    log(`ASK failed ${askRes.status}: ${JSON.stringify(askRes.data)}`, "fail");
    return false;
  }
  const askData = askRes.data as { orderId?: string; status?: string; trades?: unknown[] };
  log(`ASK placed orderId=${askData.orderId ?? "?"} status=${askData.status ?? "?"} trades=${(askData.trades ?? []).length}`, "ok");

  log("Placing LIMIT BID @ 0.50 qty 20 (crosses ASK to generate trade)...", "info");
  if (ORDER_DELAY_MS > 0) await sleep(ORDER_DELAY_MS);
  const crossRes = await placeOrder({
    marketId,
    outcomeIndex,
    side: "BID",
    type: "LIMIT",
    price: "0.5",
    quantity: "20",
  });
  if (crossRes.status !== 201) {
    log(`Cross BID failed ${crossRes.status}: ${JSON.stringify(crossRes.data)}`, "fail");
    return true;
  }
  const crossData = crossRes.data as { orderId?: string; status?: string; trades?: { price: string; quantity: string }[] };
  const trades = crossData.trades ?? [];
  log(`Cross BID placed orderId=${crossData.orderId ?? "?"} status=${crossData.status ?? "?"} trades=${trades.length}`, "ok");
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
  let okCount = 0;
  for (const marketId of marketIds) {
    if (shutdown) break;
    const ok = await runMarket(marketId);
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
