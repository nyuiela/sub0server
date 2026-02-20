import type { PrismaClient } from "@prisma/client";
import type { RequestAuth } from "./auth.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
  interface FastifyRequest {
    auth?: RequestAuth | null;
  }
}
