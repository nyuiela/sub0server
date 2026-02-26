-- CreateTable
CREATE TABLE "PendingAgentTrade" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeIndex" INTEGER NOT NULL DEFAULT 0,
    "side" TEXT NOT NULL,
    "quantity" DECIMAL(28,18) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pendingReason" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "PendingAgentTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingAgentTrade_agentId_idx" ON "PendingAgentTrade"("agentId");

-- CreateIndex
CREATE INDEX "PendingAgentTrade_marketId_idx" ON "PendingAgentTrade"("marketId");

-- CreateIndex
CREATE INDEX "PendingAgentTrade_status_idx" ON "PendingAgentTrade"("status");

-- AddForeignKey
ALTER TABLE "PendingAgentTrade" ADD CONSTRAINT "PendingAgentTrade_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAgentTrade" ADD CONSTRAINT "PendingAgentTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
