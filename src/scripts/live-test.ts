/**
 * Live interactive test runner. Runs against a running backend.
 * Loads .env from backend root (cwd when running pnpm run live-test) so API_KEY is set.
 * Default BASE_URL = http://localhost:4000 (backend PORT from .env or 4000).
 *
 * Commands (single key):
 *   q - quit
 *   p - pause / resume
 *   s - skip to next scenario
 *   r - repeat current scenario
 *   h - show help
 *   1-6 - jump to scenario 1-6
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

const SCENARIOS = [
  "health",
  "create_market",
  "list_markets",
  "get_market",
  "orderbook_stake",
  "get_market_after_orders",
] as const;

type ScenarioId = (typeof SCENARIOS)[number];

let quit = false;
let paused = false;
let skipRequested = false;
let repeatRequested = false;
let resumeResolve: (() => void) | null = null;
let currentMarketId: string | null = null;
let scenarioIndex = 0;

function log(msg: string, level: "info" | "ok" | "fail" | "cmd" = "info"): void {
  const ts = new Date().toISOString().split("T")[1].slice(0, 12);
  const prefix =
    level === "ok" ? "[OK] " : level === "fail" ? "[FAIL] " : level === "cmd" ? "[CMD] " : "";
  console.log(`${ts} ${prefix}${msg}`);
}

function truncate(data: unknown, max = 200): string {
  const s = typeof data === "string" ? data : JSON.stringify(data);
  return s.length <= max ? s : s.slice(0, max) + "...";
}

function printHelp(): void {
  console.log("\n--- Commands ---");
  console.log("  q  quit");
  console.log("  p  pause / resume");
  console.log("  s  skip to next scenario");
  console.log("  r  repeat current scenario");
  console.log("  h  show this help");
  console.log("  1-6  jump to scenario 1-6");
  console.log("----------------\n");
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

function checkInterrupt(): boolean {
  if (quit) return true;
  if (skipRequested) return true;
  return false;
}

async function waitIfPaused(): Promise<void> {
  while (paused && !quit && !skipRequested) {
    await new Promise<void>((resolve) => {
      resumeResolve = resolve;
    });
    resumeResolve = null;
  }
}

async function runHealth(): Promise<boolean> {
  log("Health check...");
  const { status, data } = await fetchApi("/health");
  if (status !== 200) {
    log(`Health returned ${status}: ${truncate(data)}`, "fail");
    return false;
  }
  log("Health OK", "ok");
  return true;
}

async function runCreateMarket(): Promise<boolean> {
  log("Create market (API key)...");
  if (checkInterrupt()) return false;
  const conditionId = `0xlive-${Date.now().toString(16)}`;
  const resolutionDate = new Date(Date.now() + 86400 * 365).toISOString();
  const { status, data } = await fetchApi("/api/markets", {
    method: "POST",
    body: {
      name: `Live test market ${Date.now()}`,
      creatorAddress: "0x0000000000000000000000000000000000000001",
      context: "Live test",
      outcomes: ["Yes", "No"],
      resolutionDate,
      oracleAddress: "0x0000000000000000000000000000000000000002",
      collateralToken: "0x0000000000000000000000000000000000000003",
      conditionId,
      platform: "NATIVE",
    },
  });
  if (checkInterrupt()) return false;
  if (status !== 201) {
    log(`Create market returned ${status}: ${truncate(data)}`, "fail");
    return false;
  }
  const market = data as { id?: string };
  currentMarketId = market.id ?? null;
  if (!currentMarketId) {
    log("Create market response missing id", "fail");
    return false;
  }
  log(`Market created: ${currentMarketId}`, "ok");
  return true;
}

async function runListMarkets(): Promise<boolean> {
  log("List OPEN markets...");
  const { status, data } = await fetchApi("/api/markets?status=OPEN&limit=10");
  if (checkInterrupt()) return false;
  if (status !== 200) {
    log(`List markets returned ${status}: ${truncate(data)}`, "fail");
    return false;
  }
  const list = data as { data?: { id?: string }[]; total?: number };
  const markets = list.data ?? [];
  const count = markets.length;
  const total = list.total ?? 0;
  log(`Open markets: ${count} items, total ${total}`, "ok");
  if (!currentMarketId && markets.length > 0) {
    currentMarketId = markets[0].id ?? null;
    if (currentMarketId) log(`Using first open market: ${currentMarketId}`, "info");
  }
  return true;
}

async function runGetMarket(): Promise<boolean> {
  if (!currentMarketId) {
    log("No market id (run create_market first)", "fail");
    return false;
  }
  log("Get market by id...");
  const { status, data } = await fetchApi(`/api/markets/${currentMarketId}`);
  if (checkInterrupt()) return false;
  if (status !== 200) {
    log(`Get market returned ${status}: ${truncate(data)}`, "fail");
    return false;
  }
  const m = data as { totalTrades?: number; activeOrderCount?: number };
  log(`Market: totalTrades=${m.totalTrades ?? 0} activeOrders=${m.activeOrderCount ?? 0}`, "ok");
  return true;
}

async function runOrderbookStake(): Promise<boolean> {
  if (!currentMarketId) {
    log("No market id (run create_market first)", "fail");
    return false;
  }
  log("Orderbook: place LIMIT BID then LIMIT ASK...");
  const bid = await fetchApi("/api/orders", {
    method: "POST",
    body: {
      marketId: currentMarketId,
      outcomeIndex: 0,
      side: "BID",
      type: "LIMIT",
      price: "0.4",
      quantity: "100",
    },
  });
  if (checkInterrupt()) return false;
  if (bid.status !== 201) {
    log(`BID order returned ${bid.status}: ${truncate(bid.data)}`, "fail");
    return false;
  }
  log("BID placed", "ok");

  const ask = await fetchApi("/api/orders", {
    method: "POST",
    body: {
      marketId: currentMarketId,
      outcomeIndex: 0,
      side: "ASK",
      type: "LIMIT",
      price: "0.5",
      quantity: "50",
    },
  });
  if (checkInterrupt()) return false;
  if (ask.status !== 201) {
    log(`ASK order returned ${ask.status}: ${truncate(ask.data)}`, "fail");
    return false;
  }
  log("ASK placed", "ok");
  return true;
}

async function runGetMarketAfterOrders(): Promise<boolean> {
  return runGetMarket();
}

const RUNNERS: Record<ScenarioId, () => Promise<boolean>> = {
  health: runHealth,
  create_market: runCreateMarket,
  list_markets: runListMarkets,
  get_market: runGetMarket,
  orderbook_stake: runOrderbookStake,
  get_market_after_orders: runGetMarketAfterOrders,
};

async function runScenario(id: ScenarioId): Promise<boolean> {
  const run = RUNNERS[id];
  if (!run) return false;
  try {
    return await run();
  } catch (err) {
    log(String(err), "fail");
    return false;
  }
}

function setupStdin(): void {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key: string) => {
    const k = key.trim().toLowerCase();
    if (k === "q") {
      quit = true;
      log("Quit requested", "cmd");
      if (resumeResolve) resumeResolve();
      return;
    }
    if (k === "p") {
      paused = !paused;
      log(paused ? "Paused" : "Resumed", "cmd");
      if (!paused && resumeResolve) resumeResolve();
      return;
    }
    if (k === "s") {
      skipRequested = true;
      log("Skip requested", "cmd");
      if (resumeResolve) resumeResolve();
      return;
    }
    if (k === "r") {
      repeatRequested = true;
      log("Repeat requested", "cmd");
      return;
    }
    if (k === "h") {
      printHelp();
      return;
    }
    const n = parseInt(k, 10);
    if (n >= 1 && n <= SCENARIOS.length) {
      scenarioIndex = n - 1;
      skipRequested = true;
      log(`Jump to scenario ${n}: ${SCENARIOS[scenarioIndex]}`, "cmd");
      if (resumeResolve) resumeResolve();
    }
  });
}

async function main(): Promise<void> {
  console.log("Live test runner");
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`API_KEY=${API_KEY ? "***" : "(not set - create market and orders will fail)"}`);
  console.log("");
  printHelp();
  console.log("Starting loop. Press keys to control.\n");

  setupStdin();

  while (!quit) {
    await waitIfPaused();
    if (quit) break;
    if (repeatRequested) {
      repeatRequested = false;
      scenarioIndex = Math.max(0, scenarioIndex - 1);
    }
    const id = SCENARIOS[scenarioIndex];
    log(`--- [${scenarioIndex + 1}/${SCENARIOS.length}] ${id} ---`);
    const ok = await runScenario(id);
    if (checkInterrupt()) {
      skipRequested = false;
      scenarioIndex = (scenarioIndex + 1) % SCENARIOS.length;
      continue;
    }
    if (!ok) {
      log(`Scenario ${id} failed`, "fail");
    }
    scenarioIndex = (scenarioIndex + 1) % SCENARIOS.length;
    const delay = 1500;
    log(`Next in ${delay}ms (q=quit p=pause s=skip r=repeat h=help 1-6=jump)`);
    await new Promise((r) => setTimeout(r, delay));
  }

  log("Bye.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
