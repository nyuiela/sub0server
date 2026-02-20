import dotenv from "dotenv";
dotenv.config();

import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { config } from "./config/index.js";
import { getSocketManager } from "./services/websocket.service.js";
import { verifyToken, getTokenFromRequest } from "./lib/jwt.js";
import { getPrismaClient, disconnectPrisma } from "./lib/prisma.js";
import { closeRedis } from "./lib/redis.js";
import { registerAgentEnqueueRoutes } from "./routes/agent-enqueue.routes.js";
import { registerUserRoutes } from "./routes/users.routes.js";
import { registerAgentRoutes } from "./routes/agents.routes.js";
import { registerMarketRoutes } from "./routes/markets.routes.js";
import { registerPositionRoutes } from "./routes/positions.routes.js";
import { registerStrategyRoutes } from "./routes/strategies.routes.js";
import { registerToolRoutes } from "./routes/tools.routes.js";
import { registerRegisterRoutes } from "./routes/register.routes.js";

interface AuthenticatedRequest {
  userId?: string | null;
}

const fastify = Fastify({ logger: true });

fastify.register(fastifyWebsocket, {
  options: { maxPayload: 65536 },
});

fastify.addHook("preValidation", async (request, reply) => {
  const token = getTokenFromRequest(
    request.headers.authorization,
    (request.query as { token?: string })?.token
  );
  if (token === null) {
    (request as AuthenticatedRequest).userId = null;
    return;
  }
  const payload = verifyToken(token);
  if (payload === null) {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }
  (request as AuthenticatedRequest).userId = payload.sub;
});

fastify.get("/ws", { websocket: true }, async (socket, req) => {
  const manager = getSocketManager();
  await manager.start();
  manager.addSocket(socket, req);
});

fastify.get("/health", async () => ({ status: "ok" }));

fastify.decorate("prisma", getPrismaClient());
await registerAgentEnqueueRoutes(fastify);
await registerUserRoutes(fastify);
await registerAgentRoutes(fastify);
await registerMarketRoutes(fastify);
await registerPositionRoutes(fastify);
await registerStrategyRoutes(fastify);
await registerToolRoutes(fastify);
await registerRegisterRoutes(fastify);

const start = async () => {
  try {
    await fastify.listen({ port: config.port, host: "0.0.0.0" });
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
