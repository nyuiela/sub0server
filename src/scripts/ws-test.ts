/**
 * One-off WebSocket test: connect to ws://localhost:4000/ws, subscribe to rooms,
 * log all messages, reply to PING. Optionally create a market via API to trigger MARKET_UPDATED.
 * Run: pnpm exec tsx src/scripts/ws-test.ts (from backend root).
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import WebSocket from "ws";

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
const WS_URL = process.env.WS_URL ?? `ws://localhost:${PORT}/ws`;
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const API_KEY = process.env.API_KEY ?? "";

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function log(label: string, data: unknown): void {
  const ts = new Date().toISOString().split("T")[1].slice(0, 12);
  console.log(`${ts} [${label}]`, typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function createMarket(): Promise<string | null> {
  if (!API_KEY) {
    log("SKIP", "No API_KEY in .env, skipping market create");
    return null;
  }
  const res = await fetch(`${BASE_URL}/api/markets`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({
      name: "WS test market",
      creatorAddress: "0x0000000000000000000000000000000000000001",
      conditionId: `ws-test-${Date.now()}`,
      resolutionDate: new Date(Date.now() + 86400000).toISOString(),
      oracleAddress: "0x0000000000000000000000000000000000000001",
      collateralToken: "0x0000000000000000000000000000000000000000",
      outcomes: ["Yes", "No"],
    }),
  });
  if (!res.ok) {
    log("CREATE_FAIL", await res.text());
    return null;
  }
  const data = (await res.json()) as { id: string };
  log("CREATE_OK", `market id=${data.id}`);
  return data.id;
}

async function main(): Promise<void> {
  log("CONNECT", WS_URL);
  const ws = new WebSocket(WS_URL);

  const connectTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      log("TIMEOUT", "connection timeout (20s)");
      ws.terminate();
    }
  }, 20000);

  ws.on("open", () => {
    clearTimeout(connectTimeout);
    log("OPEN", "connected");
    send(ws, { type: "SUBSCRIBE", payload: { room: "markets" } });
    log("SUB", "subscribed to room: markets");
  });

  ws.on("message", (raw: Buffer) => {
    let data: unknown;
    try {
      data = JSON.parse(raw.toString("utf8"));
    } catch {
      log("RAW", raw.toString("utf8"));
      return;
    }
    const msg = data as { type?: string; payload?: unknown };
    if (msg.type === "PING") {
      send(ws, { type: "PONG", payload: undefined });
      log("PONG", "sent");
      return;
    }
    log("MSG", data);
  });

  ws.on("close", (code, reason) => {
    log("CLOSE", { code, reason: reason?.toString() });
  });

  ws.on("error", (err) => {
    log("ERROR", err.message);
  });

  await new Promise<void>((resolve) => {
    ws.once("open", () => resolve());
  });

  await new Promise((r) => setTimeout(r, 1500));

  const marketId = await createMarket();
  if (marketId) {
    send(ws, { type: "SUBSCRIBE", payload: { room: `market:${marketId}` } });
    log("SUB", `subscribed to room: market:${marketId}`);
  }

  log("WAIT", "listening for 12s (expect MARKET_UPDATED if create succeeded)...");
  await new Promise((r) => setTimeout(r, 12000));

  ws.close();
  log("DONE", "closed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
