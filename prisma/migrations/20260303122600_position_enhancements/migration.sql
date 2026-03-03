-- AlterTable to add outcomeString and latestReason to Position model
ALTER TABLE "Position" ADD COLUMN     "outcomeString" TEXT,
ADD COLUMN     "latestReason" TEXT;
