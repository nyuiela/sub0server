-- CreateEnum
CREATE TYPE "MarketPlatform" AS ENUM ('NATIVE', 'POLYMARKET', 'KALSHI', 'MANIFOLD', 'OTHER');

-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "liquidity" DECIMAL(28,8),
ADD COLUMN     "platform" "MarketPlatform" NOT NULL DEFAULT 'NATIVE',
ADD COLUMN     "pnl" DECIMAL(28,8);

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "contractPositionId" TEXT;

-- CreateIndex
CREATE INDEX "Market_platform_idx" ON "Market"("platform");
