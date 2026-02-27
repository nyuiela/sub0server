-- Recreate AgentEnqueuedMarket table (use after manual drop to fix drift without full reset).
-- Matches the final state after all migrations.

CREATE TABLE IF NOT EXISTS "AgentEnqueuedMarket" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL DEFAULT 'main',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "discardReason" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentEnqueuedMarket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentEnqueuedMarket_agentId_marketId_key" ON "AgentEnqueuedMarket"("agentId", "marketId");
CREATE INDEX IF NOT EXISTS "AgentEnqueuedMarket_agentId_idx" ON "AgentEnqueuedMarket"("agentId");
CREATE INDEX IF NOT EXISTS "AgentEnqueuedMarket_marketId_idx" ON "AgentEnqueuedMarket"("marketId");
CREATE INDEX IF NOT EXISTS "AgentEnqueuedMarket_chainKey_idx" ON "AgentEnqueuedMarket"("chainKey");

ALTER TABLE "AgentEnqueuedMarket" DROP CONSTRAINT IF EXISTS "AgentEnqueuedMarket_agentId_fkey";
ALTER TABLE "AgentEnqueuedMarket" DROP CONSTRAINT IF EXISTS "AgentEnqueuedMarket_marketId_fkey";
ALTER TABLE "AgentEnqueuedMarket" ADD CONSTRAINT "AgentEnqueuedMarket_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentEnqueuedMarket" ADD CONSTRAINT "AgentEnqueuedMarket_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
