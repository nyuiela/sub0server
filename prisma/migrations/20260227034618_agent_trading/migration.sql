-- AgentEnqueuedMarket.updatedAt: add column first (it was added in a later migration 20260228000000
-- but 20260227034618 runs before it). Then drop default so Prisma can manage it.
ALTER TABLE "AgentEnqueuedMarket" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AgentEnqueuedMarket" ALTER COLUMN "updatedAt" DROP DEFAULT;
