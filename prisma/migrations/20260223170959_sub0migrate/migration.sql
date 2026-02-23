/*
  Warnings:

  - A unique constraint covering the columns `[agentId,date]` on the table `AgentTrack` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "AgentTrack_agentId_key";

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "currentExposure" DECIMAL(28,8) NOT NULL DEFAULT 0,
ADD COLUMN     "maxDrawdown" DECIMAL(28,8) NOT NULL DEFAULT 0,
ADD COLUMN     "totalLlmCost" DECIMAL(28,8) NOT NULL DEFAULT 0,
ADD COLUMN     "totalLlmTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AgentTrack" ADD COLUMN     "drawdown" DECIMAL(28,8) NOT NULL DEFAULT 0,
ADD COLUMN     "exposure" DECIMAL(28,8) NOT NULL DEFAULT 0,
ADD COLUMN     "llmCost" DECIMAL(28,8) NOT NULL DEFAULT 0,
ADD COLUMN     "llmTokensUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AgentReasoning" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "marketId" TEXT,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "userContext" TEXT NOT NULL,
    "reasoning" TEXT,
    "response" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "riskScore" DOUBLE PRECISION,
    "actionTaken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentReasoning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentReasoning_agentId_idx" ON "AgentReasoning"("agentId");

-- CreateIndex
CREATE INDEX "AgentReasoning_marketId_idx" ON "AgentReasoning"("marketId");

-- CreateIndex
CREATE INDEX "AgentReasoning_createdAt_idx" ON "AgentReasoning"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTrack_agentId_date_key" ON "AgentTrack"("agentId", "date");

-- AddForeignKey
ALTER TABLE "AgentReasoning" ADD CONSTRAINT "AgentReasoning_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReasoning" ADD CONSTRAINT "AgentReasoning_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;
