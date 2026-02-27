-- AlterTable AgentEnqueuedMarket: add status, discardReason, updatedAt (agent decision: PENDING | DISCARDED | TRADED)
ALTER TABLE "AgentEnqueuedMarket" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "AgentEnqueuedMarket" ADD COLUMN IF NOT EXISTS "discardReason" TEXT;
ALTER TABLE "AgentEnqueuedMarket" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
