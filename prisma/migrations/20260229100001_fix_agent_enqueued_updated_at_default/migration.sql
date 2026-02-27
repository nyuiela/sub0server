-- Fix drift: AgentEnqueuedMarket.updatedAt must have default (expected by Prisma schema).
-- The DB had no default after a migration was applied in a different order; this aligns it.
ALTER TABLE "AgentEnqueuedMarket" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
