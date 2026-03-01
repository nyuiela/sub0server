-- CreateTable
CREATE TABLE "Simulation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "dateRangeStart" TIMESTAMP(3) NOT NULL,
    "dateRangeEnd" TIMESTAMP(3) NOT NULL,
    "maxMarkets" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

-- Add simulationId to AgentEnqueuedMarket (nullable for existing main-chain rows)
ALTER TABLE "AgentEnqueuedMarket" ADD COLUMN "simulationId" TEXT;

-- Drop old unique so we can add (agentId, marketId, simulationId)
DROP INDEX IF EXISTS "AgentEnqueuedMarket_agentId_marketId_key";

-- CreateIndex
CREATE UNIQUE INDEX "AgentEnqueuedMarket_agentId_marketId_simulationId_key" ON "AgentEnqueuedMarket"("agentId", "marketId", "simulationId");

-- CreateIndex
CREATE INDEX "Simulation_ownerId_idx" ON "Simulation"("ownerId");
CREATE INDEX "Simulation_agentId_idx" ON "Simulation"("agentId");
CREATE INDEX "Simulation_createdAt_idx" ON "Simulation"("createdAt");
CREATE INDEX "AgentEnqueuedMarket_simulationId_idx" ON "AgentEnqueuedMarket"("simulationId");

-- AddForeignKey
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentEnqueuedMarket" ADD CONSTRAINT "AgentEnqueuedMarket_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "Simulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
