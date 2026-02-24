-- CreateTable
CREATE TABLE "AgentEnqueuedMarket" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEnqueuedMarket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentEnqueuedMarket_agentId_idx" ON "AgentEnqueuedMarket"("agentId");

-- CreateIndex
CREATE INDEX "AgentEnqueuedMarket_marketId_idx" ON "AgentEnqueuedMarket"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEnqueuedMarket_agentId_marketId_key" ON "AgentEnqueuedMarket"("agentId", "marketId");

-- AddForeignKey
ALTER TABLE "AgentEnqueuedMarket" ADD CONSTRAINT "AgentEnqueuedMarket_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEnqueuedMarket" ADD CONSTRAINT "AgentEnqueuedMarket_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
