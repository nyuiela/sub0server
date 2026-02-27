-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "agentId" TEXT,
ADD COLUMN     "crePayload" JSONB,
ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_agentId_idx" ON "Order"("agentId");
