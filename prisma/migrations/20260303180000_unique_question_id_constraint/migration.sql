-- Add unique constraint to prevent duplicate markets with same questionId
-- This ensures database-level enforcement of uniqueness for market IDs

-- Create unique index on questionId to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS "idx_market_question_id_unique" ON "Market"("questionId");

-- Add unique constraint (alternative approach if index doesn't work)
-- ALTER TABLE "Market" ADD CONSTRAINT "unique_question_id" UNIQUE ("questionId");
