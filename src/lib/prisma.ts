import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config/index.js";

declare global {
  var __prisma: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (global.__prisma === undefined) {
    const adapter = new PrismaPg({
      connectionString: config.databaseUrl,
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
