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
import { registerAgentEnqueueRoutes } from "./routes/agent-enqueue.routes.js";
import { registerUserRoutes } from "./routes/users.routes.js";
import { registerAgentRoutes } from "./routes/agents.routes.js";
import { registerMarketRoutes } from "./routes/markets.routes.js";
import { registerPositionRoutes } from "./routes/positions.routes.js";
import { registerStrategyRoutes } from "./routes/strategies.routes.js";
import { registerToolRoutes } from "./routes/tools.routes.js";
import { registerOrderRoutes } from "./routes/orders.routes.js";
import { registerActivityRoutes } from "./routes/activities.routes.js";
import { registerRegisterRoutes } from "./routes/register.routes.js";
import { registerFeedRoutes } from "./routes/feed.routes.js";
import { registerSettingsRoutes } from "./routes/settings.routes.js";
import { registerAuthRoutes } from "./routes/auth.routes.js";
import { startTradesPersistenceWorker } from "./workers/trades-persistence.worker.js";
import type { Worker } from "bullmq";
import type { TradesJobPayload } from "./workers/trades-queue.js";
import type { WebSocket } from "ws";

const fastify = Fastify({ logger: true });
let tradesWorker: Worker<TradesJobPayload> | null = null;

await fastify.register(fastifyCookie, { parseOptions: {} });
await fastify.register(fastifyCors, {
  origin: config.corsOrigin,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "api-key"],
});
fastify.register(fastifyWebsocket, {
  options: { maxPayload: 65536 },
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

fastify.get("/health", async () => ({ status: "ok" }));

fastify.decorate("prisma", getPrismaClient());
await registerAgentEnqueueRoutes(fastify);
await registerAuthRoutes(fastify);
await registerUserRoutes(fastify);
await registerAgentRoutes(fastify);
await registerMarketRoutes(fastify);
await registerPositionRoutes(fastify);
await registerStrategyRoutes(fastify);
await registerToolRoutes(fastify);
await registerOrderRoutes(fastify);
await registerActivityRoutes(fastify);
await registerRegisterRoutes(fastify);
await registerFeedRoutes(fastify);
await registerSettingsRoutes(fastify);

const start = async () => {
  try {
    const manager = getSocketManager();
    await manager.start();
    await fastify.listen({ port: config.port, host: "0.0.0.0" });
    tradesWorker = await startTradesPersistenceWorker();
    fastify.log.info("Server, WebSocket manager and trades persistence worker started");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async () => {
  if (tradesWorker) {
    await tradesWorker.close();
    tradesWorker = null;
  }
  await fastify.close();
  await disconnectPrisma();
  await closeRedis();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
