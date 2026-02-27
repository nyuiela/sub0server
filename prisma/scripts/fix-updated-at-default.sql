-- Restore default on AgentEnqueuedMarket.updatedAt so DB matches Prisma schema (fixes drift).
ALTER TABLE "AgentEnqueuedMarket" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
