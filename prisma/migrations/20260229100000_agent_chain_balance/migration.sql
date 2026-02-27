-- CreateTable: balance per trading place (main vs tenderly simulate)
CREATE TABLE "AgentChainBalance" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL,
    "balance" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentChainBalance_pkey" PRIMARY KEY ("id")
);

-- Add chainKey to AgentEnqueuedMarket (default main)
ALTER TABLE "AgentEnqueuedMarket" ADD COLUMN "chainKey" TEXT NOT NULL DEFAULT 'main';

-- Unique and indexes for AgentChainBalance
CREATE UNIQUE INDEX "AgentChainBalance_agentId_chainKey_key" ON "AgentChainBalance"("agentId", "chainKey");
CREATE INDEX "AgentChainBalance_agentId_idx" ON "AgentChainBalance"("agentId");
CREATE INDEX "AgentChainBalance_chainKey_idx" ON "AgentChainBalance"("chainKey");

-- FK
ALTER TABLE "AgentChainBalance" ADD CONSTRAINT "AgentChainBalance_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Index for chainKey on AgentEnqueuedMarket
CREATE INDEX "AgentEnqueuedMarket_chainKey_idx" ON "AgentEnqueuedMarket"("chainKey");
