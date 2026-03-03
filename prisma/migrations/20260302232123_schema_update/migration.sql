/*
  Warnings:

  - Added the required column `tradeReason` to the `AgentEnqueuedMarket` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tradeReason` to the `PendingAgentTrade` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "AgentEnqueuedMarket" ADD COLUMN     "tradeReason" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PendingAgentTrade" ADD COLUMN     "tradeReason" TEXT NOT NULL;
