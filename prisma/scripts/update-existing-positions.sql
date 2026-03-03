-- Update existing positions with outcome strings and latest reasoning
-- This script should be run after the schema migration to populate new fields

-- Update outcomeString for all existing positions
UPDATE "Position" p
SET "outcomeString" = (
  SELECT CASE 
    WHEN m.outcomes IS NOT NULL THEN
      CASE 
        WHEN jsonb_typeof(m.outcomes) = 'array' AND p."outcomeIndex" >= 0 THEN
          (m.outcomes->>p."outcomeIndex")::text
        ELSE CONCAT('Outcome ', p."outcomeIndex")
      END
    ELSE CONCAT('Outcome ', p."outcomeIndex")
  END
  FROM "Market" m 
  WHERE m.id = p."marketId"
)
WHERE "outcomeString" IS NULL;

-- Update latestReason from tradeReason for existing positions
UPDATE "Position"
SET "latestReason" = "tradeReason"
WHERE "latestReason" IS NULL AND "tradeReason" IS NOT NULL;

-- Add index for better query performance on new fields
CREATE INDEX IF NOT EXISTS "idx_position_outcome_string" ON "Position"("outcomeString");
CREATE INDEX IF NOT EXISTS "idx_position_latest_reason" ON "Position"("latestReason") WHERE "latestReason" IS NOT NULL;
