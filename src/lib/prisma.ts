import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config/index.js";

declare global {
  var __prisma: PrismaClient | undefined;
}

const IDLE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

export function getPrismaClient(): PrismaClient {
  if (global.__prisma === undefined) {
    const adapter = new PrismaPg({
      connectionString: config.databaseUrl,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      max: 10,
    });
    global.__prisma = new PrismaClient({ adapter });
  }
  return global.__prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (global.__prisma) {
    await global.__prisma.$disconnect();
    global.__prisma = undefined;
  }
}
