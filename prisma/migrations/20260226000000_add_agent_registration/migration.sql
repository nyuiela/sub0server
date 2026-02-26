-- CreateTable
CREATE TABLE "AgentRegistration" (
    "id" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "claimCode" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNCLAIMED',
    "claimedByUserId" TEXT,
    "claimedAgentId" TEXT,
    "walletAddress" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRegistration_claimCode_key" ON "AgentRegistration"("claimCode");

-- CreateIndex (one-to-one with Agent)
CREATE UNIQUE INDEX "AgentRegistration_claimedAgentId_key" ON "AgentRegistration"("claimedAgentId");

-- CreateIndex
CREATE INDEX "AgentRegistration_apiKeyHash_idx" ON "AgentRegistration"("apiKeyHash");

-- CreateIndex
CREATE INDEX "AgentRegistration_claimCode_idx" ON "AgentRegistration"("claimCode");

-- CreateIndex
CREATE INDEX "AgentRegistration_status_idx" ON "AgentRegistration"("status");

-- AddForeignKey
ALTER TABLE "AgentRegistration" ADD CONSTRAINT "AgentRegistration_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRegistration" ADD CONSTRAINT "AgentRegistration_claimedAgentId_fkey" FOREIGN KEY ("claimedAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
