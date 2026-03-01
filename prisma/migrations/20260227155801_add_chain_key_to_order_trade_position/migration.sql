-- Add chainKey to Order, Trade, Position so simulate (tenderly) data is separate from live (main).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "chainKey" TEXT;
CREATE INDEX IF NOT EXISTS "Order_chainKey_idx" ON "Order"("chainKey");

ALTER TABLE "Trade" ADD COLUMN IF NOT EXISTS "chainKey" TEXT;
CREATE INDEX IF NOT EXISTS "Trade_chainKey_idx" ON "Trade"("chainKey");

ALTER TABLE "Position" ADD COLUMN IF NOT EXISTS "chainKey" TEXT;
CREATE INDEX IF NOT EXISTS "Position_chainKey_idx" ON "Position"("chainKey");
