/*
  Warnings:

  - The `status` column on the `PendingAgentTrade` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `side` on the `PendingAgentTrade` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "PendingAgentTradeStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BID', 'ASK');

-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "liquiditySeeded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PendingAgentTrade" DROP COLUMN "side",
ADD COLUMN     "side" "OrderSide" NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "PendingAgentTradeStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "PendingAgentTrade_status_idx" ON "PendingAgentTrade"("status");
