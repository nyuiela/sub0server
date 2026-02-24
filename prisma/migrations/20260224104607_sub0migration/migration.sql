-- CreateTable
CREATE TABLE "UserVault" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentOpenClaw" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "soul" TEXT,
    "persona" TEXT,
    "skill" TEXT,
    "methodology" TEXT,
    "failed_tests" TEXT,
    "context" TEXT,
    "constraints" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentOpenClaw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserVault_userId_key" ON "UserVault"("userId");

-- CreateIndex
CREATE INDEX "UserVault_userId_idx" ON "UserVault"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentOpenClaw_agentId_key" ON "AgentOpenClaw"("agentId");

-- CreateIndex
CREATE INDEX "AgentOpenClaw_agentId_idx" ON "AgentOpenClaw"("agentId");

-- AddForeignKey
ALTER TABLE "UserVault" ADD CONSTRAINT "UserVault_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentOpenClaw" ADD CONSTRAINT "AgentOpenClaw_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
