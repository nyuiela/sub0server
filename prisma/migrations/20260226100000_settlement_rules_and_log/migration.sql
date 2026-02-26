-- AlterTable: add settlementRules to Market
ALTER TABLE "Market" ADD COLUMN IF NOT EXISTS "settlementRules" TEXT;

-- CreateTable: MarketSettlementLog
CREATE TABLE "MarketSettlementLog" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "consensus" BOOLEAN NOT NULL,
    "outcomeArray" JSONB,
    "agentAReason" TEXT,
    "agentBReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSettlementLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketSettlementLog_marketId_idx" ON "MarketSettlementLog"("marketId");
CREATE INDEX "MarketSettlementLog_questionId_idx" ON "MarketSettlementLog"("questionId");

-- AddForeignKey
ALTER TABLE "MarketSettlementLog" ADD CONSTRAINT "MarketSettlementLog_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
