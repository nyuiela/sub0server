-- Make conditionId optional (draft markets have no on-chain condition yet).
ALTER TABLE "Market" ALTER COLUMN "conditionId" DROP NOT NULL;

-- Add createMarketTxHash for audit when market is created via CRE.
ALTER TABLE "Market" ADD COLUMN "createMarketTxHash" TEXT;
