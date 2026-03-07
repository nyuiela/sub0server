-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "orderId" TEXT;

-- CreateIndex
CREATE INDEX "Trade_orderId_idx" ON "Trade"("orderId");
