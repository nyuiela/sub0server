import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";

declare global {
  var __prisma: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (global.__prisma === undefined) {
    global.__prisma = new PrismaClient({
      datasources: { db: { url: config.databaseUrl } },
    });
  }
  return global.__prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (global.__prisma) {
    await global.__prisma.$disconnect();
    global.__prisma = undefined;
  }
}
