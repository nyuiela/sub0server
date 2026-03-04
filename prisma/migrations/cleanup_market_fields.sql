-- Clean up Market table fields
-- Remove fields that are not needed for market creation

-- Remove tradeReason (only needed for agent trades, not markets)
ALTER TABLE "Market" DROP COLUMN IF EXISTS "tradeReason";

-- Remove confidence (only for agent trading, not market creation)  
ALTER TABLE "Market" DROP COLUMN IF EXISTS "confidence";

-- Remove pnl (markets should use volume, not pnl)
ALTER TABLE "Market" DROP COLUMN IF EXISTS "pnl";

-- Remove agentSource (not needed for markets)
ALTER TABLE "Market" DROP COLUMN IF EXISTS "agentSource";

-- Note: volume field already exists and is correct for total amount in market
-- Note: liquidity field already exists and is correct for initial liquidity seeding
