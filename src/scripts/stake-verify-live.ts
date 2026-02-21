/**
 * Live test: stake on one market (buy then sell with crossing prices), then verify
 * that orders and trades are persisted, market volume is updated, and Redis queue
 * is drained.
 *
 * Prerequisites:
 * - Backend server running (e.g. pnpm dev)
 * - Trades persistence worker running (pnpm run worker:trades)
 * - .env with DATABASE_URL, REDIS_URL, JWT_SECRET, API_KEY, PORT (optional)
 *
 * Run: pnpm exec tsx src/scripts/stake-verify-live.ts (from backend root)
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

const PORT = process.env.PORT ?? "4000";
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const API_KEY = process.env.API_KEY ?? "";

const POLL_MS = 500;
/** Allow time for worker to process backlog (e.g. 100+ jobs) before our 2 orders. */
const MAX_WAIT_MS = 90_000;

function log(msg: string, level: "info" | "ok" | "fail" | "warn" = "info"): void {
  const ts = new Date().toISOString().split("T")[1].slice(0, 12);
  const prefix =
    level === "ok" ? "[OK] " : level === "fail" ? "[FAIL] " : level === "warn" ? "[WARN] " : "";
  console.log(`${ts} ${prefix}${msg}`);
}

async function fetchApi(
  path: string,
  options: { method?: string; body?: object } = {}
): Promise<{ status: number; data: unknown }> {
  const url = `${BASE_URL.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(API_KEY ? { "x-api-key": API_KEY } : {}),
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

async function main(): Promise<void> {
  console.log("Stake & verify live test");
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`API_KEY=${API_KEY ? "***" : "(not set)"}`);
  console.log("");

  if (!API_KEY) {
    log("API_KEY required for orders", "fail");
    process.exit(1);
  }

  const { getPrismaClient } = await import("../lib/prisma.js");
  const { getTradesQueue } = await import("../workers/trades-queue.js");

  const prisma = getPrismaClient();

  let marketId: string;

  log("Health check...");
  let health: { status: number; data: unknown };
  try {
    health = await fetchApi("/health");
  } catch (err) {
    const causeStr = err instanceof Error && err.cause != null ? String(err.cause) : "";
    if (causeStr.includes("ECONNREFUSED") || (err instanceof Error && err.message?.includes("fetch failed"))) {
      log(`Cannot connect to ${BASE_URL}. Start the backend (e.g. pnpm dev) and try again.`, "fail");
    } else {
      log(String(err), "fail");
    }
    process.exit(1);
  }
  if (health.status !== 200) {
    log(`Health failed: ${health.status}`, "fail");
    process.exit(1);
  }
  log("Health OK", "ok");

  log("Create market...");
  const conditionId = `0xstake-verify-${Date.now().toString(16)}`;
  const resolutionDate = new Date(Date.now() + 86400 * 365).toISOString();
  const createRes = await fetchApi("/api/markets", {
    method: "POST",
    body: {
      name: `Stake verify ${Date.now()}`,
      creatorAddress: "0x0000000000000000000000000000000000000001",
      context: "Stake verify live test",
      outcomes: ["Yes", "No"],
      resolutionDate,
      oracleAddress: "0x0000000000000000000000000000000000000002",
      collateralToken: "0x0000000000000000000000000000000000000003",
      conditionId,
      platform: "NATIVE",
    },
  });
  if (createRes.status !== 201) {
    log(`Create market failed: ${createRes.status} ${JSON.stringify(createRes.data)}`, "fail");
    process.exit(1);
  }
  const market = createRes.data as { id?: string };
  marketId = market.id ?? "";
  if (!marketId) {
    log("Create market response missing id", "fail");
    process.exit(1);
  }
  log(`Market created: ${marketId}`, "ok");

  const bidQty = "100";
  const askQty = "60";
  const price = "0.40";
  const expectedTradeVolume = 60 * 0.4;

  log("Place BID (buy) LIMIT 0.40 x 100...");
  const bidRes = await fetchApi("/api/orders", {
    method: "POST",
    body: {
      marketId,
      side: "BID",
      type: "LIMIT",
      price,
      quantity: bidQty,
    },
  });
  if (bidRes.status !== 201) {
    log(`BID failed: ${bidRes.status} ${JSON.stringify(bidRes.data)}`, "fail");
    process.exit(1);
  }
  const bidData = bidRes.data as { orderId?: string; trades?: unknown[] };
  log(`BID placed orderId=${bidData.orderId ?? "?"} trades=${bidData.trades?.length ?? 0}`, "ok");

  log("Place ASK (sell) LIMIT 0.40 x 60 (crosses BID)...");
  const askRes = await fetchApi("/api/orders", {
    method: "POST",
    body: {
      marketId,
      side: "ASK",
      type: "LIMIT",
      price,
      quantity: askQty,
    },
  });
  if (askRes.status !== 201) {
    log(`ASK failed: ${askRes.status} ${JSON.stringify(askRes.data)}`, "fail");
    process.exit(1);
  }
  const askData = askRes.data as { orderId?: string; trades?: unknown[] };
  log(`ASK placed orderId=${askData.orderId ?? "?"} trades=${askData.trades?.length ?? 0}`, "ok");

  log("Waiting for persistence worker (poll DB, queue may have backlog)...");
  const deadline = Date.now() + MAX_WAIT_MS;
  let ordersCount = 0;
  let tradesCount = 0;
  const queue = await getTradesQueue();
  while (Date.now() < deadline) {
    ordersCount = await prisma.order.count({ where: { marketId } });
    tradesCount = await prisma.trade.count({ where: { marketId } });
    if (ordersCount >= 2 && tradesCount >= 1) break;
    const [waiting, active] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount()]);
    if (waiting === 0 && active === 0 && ordersCount < 2) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      ordersCount = await prisma.order.count({ where: { marketId } });
      tradesCount = await prisma.trade.count({ where: { marketId } });
      break;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  const dbChecks: { name: string; pass: boolean; detail: string }[] = [];

  ordersCount = await prisma.order.count({ where: { marketId } });
  dbChecks.push({
    name: "Orders in DB",
    pass: ordersCount >= 2,
    detail: `expected >= 2, got ${ordersCount}`,
  });

  tradesCount = await prisma.trade.count({ where: { marketId } });
  dbChecks.push({
    name: "Trades in DB",
    pass: tradesCount >= 1,
    detail: `expected >= 1, got ${tradesCount}`,
  });

  const marketRow = await prisma.market.findUnique({
    where: { id: marketId },
    select: { volume: true },
  });
  const vol = marketRow?.volume != null ? Number(marketRow.volume) : 0;
  const volumeOk = vol >= expectedTradeVolume - 0.01 && vol <= expectedTradeVolume + 0.01;
  dbChecks.push({
    name: "Market volume updated",
    pass: volumeOk,
    detail: `expected ~${expectedTradeVolume}, got ${vol}`,
  });

  const orders = await prisma.order.findMany({
    where: { marketId },
    orderBy: { createdAt: "asc" },
    select: { id: true, side: true, status: true, amount: true, price: true },
  });
  const statuses = new Set(orders.map((o) => o.status));
  const validStatuses = ["FILLED", "PARTIALLY_FILLED", "LIVE", "CANCELLED", "REJECTED"];
  const allValid = orders.every((o) => validStatuses.includes(o.status));
  dbChecks.push({
    name: "Order statuses valid",
    pass: allValid,
    detail: Array.from(statuses).join(", ") || "none",
  });

  const trades = await prisma.trade.findMany({
    where: { marketId },
    select: { id: true, side: true, amount: true, price: true },
  });
  const tradeVolumeSum = trades.reduce((acc, t) => acc + Number(t.amount) * Number(t.price), 0);
  dbChecks.push({
    name: "Trade volume sum matches market",
    pass: Math.abs(tradeVolumeSum - vol) < 0.01,
    detail: `trades sum=${tradeVolumeSum.toFixed(4)} market vol=${vol}`,
  });

  const [waiting, active] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount()]);
  const queueDrained = waiting === 0 && active === 0;
  dbChecks.push({
    name: "Redis queue drained",
    pass: queueDrained,
    detail: `waiting=${waiting} active=${active}`,
  });

  console.log("");
  console.log("--- Verification ---");
  let failed = 0;
  for (const c of dbChecks) {
    if (c.pass) {
      log(`${c.name}: ${c.detail}`, "ok");
    } else {
      log(`${c.name}: ${c.detail}`, "fail");
      failed++;
    }
  }

  if (failed > 0) {
    log(`${failed} check(s) failed`, "fail");
    process.exit(1);
  }

  log("All checks passed. DB and Redis state correct after stake.", "ok");
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
