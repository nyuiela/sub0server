import dotenv from "dotenv";
dotenv.config();

import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import { config } from "./config/index.js";
import { getSocketManager } from "./services/websocket.service.js";
import { getPrismaClient, disconnectPrisma } from "./lib/prisma.js";
import { closeRedis } from "./lib/redis.js";
import { resolveRequestAuth } from "./lib/auth.js";
import { registerUserRoutes } from "./routes/users.routes.js";
import { registerAgentRoutes } from "./routes/agents.routes.js";
import { registerAgentPendingTradesRoutes } from "./routes/agent-pending-trades.routes.js";
import { registerMarketRoutes } from "./routes/markets.routes.js";
import { registerAgentMarketsInternalRoutes } from "./routes/agent-markets-internal.routes.js";
import { registerPositionRoutes } from "./routes/positions.routes.js";
import { registerStrategyRoutes } from "./routes/strategies.routes.js";
import { registerToolRoutes } from "./routes/tools.routes.js";
import { registerOrderRoutes } from "./routes/orders.routes.js";
import { registerActivityRoutes } from "./routes/activities.routes.js";
import { registerRegisterRoutes } from "./routes/register.routes.js";
import { registerFeedRoutes } from "./routes/feed.routes.js";
import { registerSettingsRoutes } from "./routes/settings.routes.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerSdkAgentRoutes } from "./routes/sdk-agent.routes.js";
import { registerSdkApiRoutes } from "./routes/sdk-api.routes.js";
import { registerCreCallbackRoutes } from "./routes/cre-callback.routes.js";
import { registerCreWorkflowCallbackRoutes } from "./routes/cre-workflow-callbacks.routes.js";
import { registerSettlementCallbackRoutes } from "./routes/settlement-callbacks.routes.js";
import { registerCcipInternalRoutes } from "./routes/ccip-internal.routes.js";
import { registerTradesRoutes } from "./routes/trades.routes.js";
import { registerUserBalanceRoutes } from "./routes/user-balances.routes.js";
import { registerSimulateRoutes } from "./routes/simulate.routes.js";
import { registerAgentDelegationRoutes } from "./routes/agent-delegation.routes.js";
import { registerEnsResolverRoutes } from "./routes/ens-resolver.routes.js";
import type { WebSocket } from "ws";

const fastify = Fastify({ logger: true });

await fastify.register(fastifyCookie, { parseOptions: {} });
await fastify.register(fastifyCors, {
  origin: config.corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "api-key"],
});
await fastify.register(fastifyWebsocket, {
  options: { maxPayload: 65536 },
});

fastify.addHook("onRequest", async (request) => {
  const path = request.url.split("?")[0];
  const isCrePost =
    path === "/api/cre/markets/onchain-created" ||
    path === "/api/cre/markets/onchain-created-batch" ||
    path === "/api/cre/agent-keys" ||
    path === "/api/cre/buy" ||
    path === "/api/cre/sell" ||
    path === "/api/cre/quote" ||
    path === "/api/cre/stake" ||
    path === "/api/cre/redeem" ||
    path === "/api/cre/execute-confidential-trade" ||
    path === "/api/internal/cre/macro-data" ||
    path === "/api/internal/cre/webhook-event" ||
    path === "/api/internal/cre/registry-record" ||
    path === "/api/internal/cre/x402-charge";
  if (request.method === "POST" && isCrePost) {
    const ct = request.headers["content-type"];
    if (!ct || String(ct).toLowerCase() === "undefined") {
      request.headers["content-type"] = "application/json";
    }
  }
});

fastify.addHook("preValidation", async (request) => {
  try {
    request.auth = await resolveRequestAuth(request);
  } catch (err) {
    if (request.url.startsWith("/ws")) {
      request.auth = null;
    } else {
      throw err;
    }
  }
});

const WS_TEST_INTERVAL_MS = 5000;

const WS_OPEN = 1;

function sendWsTestMessage(socket: WebSocket, label: string): void {
  try {
    if (socket.readyState !== WS_OPEN) {
      fastify.log.info({ readyState: socket.readyState }, "ws-test skip send (not open)");
      return;
    }
    const payload = JSON.stringify({
      type: "PING",
      message: label,
      timestamp: Date.now(),
    });
    socket.send(payload);
    fastify.log.info({ label }, "ws-test sent");
  } catch (err) {
    fastify.log.warn({ err }, "ws-test send failed");
  }
}

function getRawSocket(connection: unknown): WebSocket | null {
  if (connection === null || typeof connection !== "object") return null;
  const conn = connection as { socket?: WebSocket; send?: (data: unknown) => void };
  if (typeof conn.send === "function") return connection as WebSocket;
  if (conn.socket != null && typeof (conn.socket as WebSocket).send === "function") return conn.socket as WebSocket;
  return null;
}

function debugConnection(connection: unknown): Record<string, unknown> {
  if (connection === null || typeof connection !== "object") return { type: typeof connection };
  const c = connection as Record<string, unknown>;
  const keys = Object.keys(c).filter((k) => !k.startsWith("_"));
  const out: Record<string, unknown> = { keys, constructor: (c as object).constructor?.name };
  for (const k of ["send", "on", "socket", "raw"]) {
    if (k in c) out[k] = typeof (c as Record<string, unknown>)[k];
  }
  return out;
}

fastify.get("/ws-test", { websocket: true }, (connection: unknown, second: unknown) => {
  let socket = getRawSocket(connection);
  if (socket === null && second !== null && typeof second === "object") {
    socket = getRawSocket(second);
  }
  if (socket === null) {
    fastify.log.warn(
      { connection: debugConnection(connection), second: debugConnection(second) },
      "ws-test: could not resolve WebSocket"
    );
    return;
  }
  const ws = socket;
  fastify.log.info({ readyState: ws.readyState }, "ws-test client connected");
  const sendActive = () => sendWsTestMessage(ws, "ACTIVE");
  let interval: ReturnType<typeof setInterval> | null = null;
  ws.on("close", () => {
    if (interval) clearInterval(interval);
    fastify.log.info("ws-test client disconnected");
  });
  ws.on("error", (err: Error) => {
    if (interval) clearInterval(interval);
    fastify.log.warn({ err }, "ws-test client error");
  });
  function startSending() {
    sendActive();
    interval = setInterval(sendActive, WS_TEST_INTERVAL_MS);
  }
  if (ws.readyState === WS_OPEN) {
    startSending();
  } else {
    ws.once("open", startSending);
  }
});

fastify.get("/ws", { websocket: true }, (connection, req) => {
  const conn = connection as unknown as { socket?: WebSocket } & WebSocket;
  const rawSocket =
    typeof conn.send === "function"
      ? (connection as WebSocket)
      : (conn.socket ?? (connection as WebSocket));
  try {
    const manager = getSocketManager();
    manager.addSocket(rawSocket, req);
  } catch (err) {
    fastify.log.error({ err }, "WebSocket addSocket failed");
  }
});

fastify.get("/", async () => ({
  service: "sub0server",
  sub0serverActive: true,
  status: "active",
  health: "ok",
  version: "1.0.0",
  timestamp: new Date().toISOString(),
  endpoints: {
    health: "/health",
    healthCheck: "/health",
    markets: "/api/markets",
    agents: "/api/agents",
    agentsPublic: "/api/agents/public",
  },
}));

fastify.get("/health", async () => ({
  status: "ok",
  sub0serverActive: true,
  service: "sub0server",
  timestamp: new Date().toISOString(),
}));

fastify.decorate("prisma", getPrismaClient());
await registerAuthRoutes(fastify);
await registerSdkAgentRoutes(fastify);
await registerSdkApiRoutes(fastify);
await registerCreCallbackRoutes(fastify);
await registerCreWorkflowCallbackRoutes(fastify);
await registerSettlementCallbackRoutes(fastify);
await registerCcipInternalRoutes(fastify);
await registerUserRoutes(fastify);
await registerAgentRoutes(fastify);
await registerAgentPendingTradesRoutes(fastify);
await registerMarketRoutes(fastify);
await registerAgentMarketsInternalRoutes(fastify);
await registerPositionRoutes(fastify);
await registerStrategyRoutes(fastify);
await registerToolRoutes(fastify);
await registerOrderRoutes(fastify);
await registerActivityRoutes(fastify);
await registerRegisterRoutes(fastify);
await registerFeedRoutes(fastify);
await registerSettingsRoutes(fastify);
await registerTradesRoutes(fastify);
await registerUserBalanceRoutes(fastify);
await registerSimulateRoutes(fastify);
await registerAgentDelegationRoutes(fastify);
await registerEnsResolverRoutes(fastify);

const start = async () => {
  try {
    const manager = getSocketManager();
    await manager.start();
    await fastify.listen({ port: config.port, host: "0.0.0.0" });
    fastify.log.info("Server and WebSocket manager started. Orchestration delegated to CRE workflows.");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  await fastify.close();
  await disconnectPrisma();
  await closeRedis();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
