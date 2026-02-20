import WebSocket from "ws";
import { config, REDIS_CHANNELS } from "../config/index.js";
import { getRedisPublisher } from "../lib/redis.js";
import { getSocketManager } from "./websocket.service.js";
import { WS_EVENT_NAMES } from "../types/websocket-events.js";

const BINANCE_BTC_SYMBOL = "btcusdt";
const RECONNECT_DELAY_MS = 5000;

interface BinanceTickerMessage {
  e: string;
  s: string;
  c: string;
  p: string;
}

function parseSymbol(s: string): string {
  const upper = s.toUpperCase();
  if (upper.endsWith("USDT")) return upper.slice(0, -4) + "-USD";
  return upper;
}

async function broadcastPrice(symbol: string, price: string, source: string): Promise<void> {
  const room = `market:${symbol}`;
  const payload = {
    type: WS_EVENT_NAMES.PRICE_UPDATE,
    payload: {
      symbol,
      price,
      source,
      timestamp: new Date().toISOString(),
    },
  };

  const manager = getSocketManager();
  await manager.start();
  await manager.broadcastToRoom(room, payload);

  const pub = await getRedisPublisher();
  await pub.publish(
    REDIS_CHANNELS.PRICE_FEED,
    JSON.stringify({ symbol, price, source })
  );
}

function connectBinance(): void {
  const url = `${config.binanceWsUrl}/${BINANCE_BTC_SYMBOL}@ticker`;
  const ws = new WebSocket(url);

  ws.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString()) as BinanceTickerMessage;
      if (msg.e === "24hTicker" && msg.c) {
        const symbol = parseSymbol(msg.s);
        broadcastPrice(symbol, msg.c, "binance").catch((err) =>
          console.error("broadcastPrice error:", err)
        );
      }
    } catch (err) {
      console.error("Binance message parse error:", err);
    }
  });

  ws.on("close", () => {
    setTimeout(connectBinance, RECONNECT_DELAY_MS);
  });

  ws.on("error", (err: Error) => {
    console.error("Binance WS error:", err);
  });
}

async function main(): Promise<void> {
  connectBinance();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
