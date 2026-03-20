/*
  Warnings:

  - You are about to drop the column `orderId` on the `Trade` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- DropIndex
DROP INDEX "Trade_orderId_idx";

-- AlterTable
ALTER TABLE "AgentEnqueuedMarket" ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "AgentStrategy" ADD COLUMN     "allowedMarketTypes" TEXT,
ADD COLUMN     "maxDailyTrades" INTEGER,
ADD COLUMN     "maxExposureUsd" DOUBLE PRECISION,
ADD COLUMN     "riskLevel" "RiskLevel";

-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "onchainTxHash" TEXT,
ADD COLUMN     "workflowRunId" TEXT;

-- AlterTable
ALTER TABLE "Trade" DROP COLUMN "orderId";
