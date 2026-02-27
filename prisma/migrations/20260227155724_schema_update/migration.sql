-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DEPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('OPEN', 'RESOLVING', 'CLOSED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "MarketPlatform" AS ENUM ('NATIVE', 'POLYMARKET', 'KALSHI', 'MANIFOLD', 'OTHER');

-- CreateEnum
CREATE TYPE "PositionSide" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED', 'LIQUIDATED');

-- CreateEnum
CREATE TYPE "StrategyPref" AS ENUM ('AMM_ONLY', 'ORDERBOOK', 'HYBRID');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT,
    "address" TEXT NOT NULL,
    "email" TEXT,
    "imageUrl" TEXT,
    "authMethod" TEXT,
    "totalVolume" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "pnl" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserVault" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserVault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "walletAddress" TEXT,
    "encryptedPrivateKey" TEXT NOT NULL,
    "modelSettings" JSONB NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "balance" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "tradedAmount" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "pnl" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "currentExposure" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "maxDrawdown" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalLlmTokens" INTEGER NOT NULL DEFAULT 0,
    "totalLlmCost" DECIMAL(28,8) NOT NULL DEFAULT 0,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentChainBalance" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL,
    "balance" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentChainBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingAgentTrade" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeIndex" INTEGER NOT NULL DEFAULT 0,
    "side" TEXT NOT NULL,
    "quantity" DECIMAL(28,18) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pendingReason" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "PendingAgentTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentEnqueuedMarket" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL DEFAULT 'main',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "discardReason" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEnqueuedMarket_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "AgentStrategy" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "preference" "StrategyPref" NOT NULL DEFAULT 'HYBRID',
    "maxSlippage" DOUBLE PRECISION NOT NULL,
    "spreadTolerance" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "AgentStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTrack" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "volume" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "trades" INTEGER NOT NULL DEFAULT 0,
    "pnl" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "exposure" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "drawdown" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "llmTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "llmCost" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "persona" TEXT,
    "imageUrl" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creatorAddress" TEXT NOT NULL,
    "volume" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "context" TEXT,
    "imageUrl" TEXT,
    "outcomes" JSONB NOT NULL,
    "outcomePositionIds" JSONB,
    "sourceUrl" TEXT,
    "resolutionDate" TIMESTAMP(3) NOT NULL,
    "oracleAddress" TEXT NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'OPEN',
    "collateralToken" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "questionId" TEXT,
    "platform" "MarketPlatform" NOT NULL DEFAULT 'NATIVE',
    "agentSource" TEXT,
    "settlementRules" TEXT,
    "liquidity" DECIMAL(28,8),
    "confidence" DOUBLE PRECISION,
    "pnl" DECIMAL(28,8),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSettlementLog" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "consensus" BOOLEAN NOT NULL,
    "outcomeArray" JSONB,
    "agentAReason" TEXT,
    "agentBReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSettlementLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "address" TEXT NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "outcomeIndex" INTEGER NOT NULL,
    "side" "PositionSide" NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "avgPrice" DECIMAL(28,18) NOT NULL,
    "collateralLocked" DECIMAL(28,18) NOT NULL,
    "isAmm" BOOLEAN NOT NULL DEFAULT false,
    "contractPositionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeIndex" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "agentId" TEXT,
    "side" TEXT NOT NULL,
    "amount" DECIMAL(28,18) NOT NULL,
    "price" DECIMAL(28,18) NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcomeIndex" INTEGER NOT NULL DEFAULT 0,
    "side" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LIMIT',
    "amount" DECIMAL(28,18) NOT NULL,
    "price" DECIMAL(28,18) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "crePayload" JSONB,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "News" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "imageUrl" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "News_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedItem" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "sourceUrl" TEXT,
    "imageUrl" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiLog" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "marketId" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentReasoning" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "marketId" TEXT,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "userContext" TEXT NOT NULL,
    "reasoning" TEXT,
    "response" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "riskScore" DOUBLE PRECISION,
    "actionTaken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentReasoning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "fee" DECIMAL(28,8) NOT NULL,
    "receiverAddress" TEXT NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_address_key" ON "User"("address");

-- CreateIndex
CREATE INDEX "User_username_idx" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "UserVault_userId_key" ON "UserVault"("userId");

-- CreateIndex
CREATE INDEX "UserVault_userId_idx" ON "UserVault"("userId");

-- CreateIndex
CREATE INDEX "Agent_ownerId_idx" ON "Agent"("ownerId");

-- CreateIndex
CREATE INDEX "Agent_status_idx" ON "Agent"("status");

-- CreateIndex
CREATE INDEX "Agent_templateId_idx" ON "Agent"("templateId");

-- CreateIndex
CREATE INDEX "AgentChainBalance_agentId_idx" ON "AgentChainBalance"("agentId");

-- CreateIndex
CREATE INDEX "AgentChainBalance_chainKey_idx" ON "AgentChainBalance"("chainKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentChainBalance_agentId_chainKey_key" ON "AgentChainBalance"("agentId", "chainKey");

-- CreateIndex
CREATE INDEX "PendingAgentTrade_agentId_idx" ON "PendingAgentTrade"("agentId");

-- CreateIndex
CREATE INDEX "PendingAgentTrade_marketId_idx" ON "PendingAgentTrade"("marketId");

-- CreateIndex
CREATE INDEX "PendingAgentTrade_status_idx" ON "PendingAgentTrade"("status");

-- CreateIndex
CREATE INDEX "AgentEnqueuedMarket_agentId_idx" ON "AgentEnqueuedMarket"("agentId");

-- CreateIndex
CREATE INDEX "AgentEnqueuedMarket_marketId_idx" ON "AgentEnqueuedMarket"("marketId");

-- CreateIndex
CREATE INDEX "AgentEnqueuedMarket_chainKey_idx" ON "AgentEnqueuedMarket"("chainKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentEnqueuedMarket_agentId_marketId_key" ON "AgentEnqueuedMarket"("agentId", "marketId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentOpenClaw_agentId_key" ON "AgentOpenClaw"("agentId");

-- CreateIndex
CREATE INDEX "AgentOpenClaw_agentId_idx" ON "AgentOpenClaw"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStrategy_agentId_key" ON "AgentStrategy"("agentId");

-- CreateIndex
CREATE INDEX "AgentTrack_agentId_idx" ON "AgentTrack"("agentId");

-- CreateIndex
CREATE INDEX "AgentTrack_date_idx" ON "AgentTrack"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTrack_agentId_date_key" ON "AgentTrack"("agentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Market_conditionId_key" ON "Market"("conditionId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_questionId_key" ON "Market"("questionId");

-- CreateIndex
CREATE INDEX "Market_creatorAddress_idx" ON "Market"("creatorAddress");

-- CreateIndex
CREATE INDEX "Market_status_idx" ON "Market"("status");

-- CreateIndex
CREATE INDEX "Market_conditionId_idx" ON "Market"("conditionId");

-- CreateIndex
CREATE INDEX "Market_questionId_idx" ON "Market"("questionId");

-- CreateIndex
CREATE INDEX "Market_platform_idx" ON "Market"("platform");

-- CreateIndex
CREATE INDEX "MarketSettlementLog_marketId_idx" ON "MarketSettlementLog"("marketId");

-- CreateIndex
CREATE INDEX "MarketSettlementLog_questionId_idx" ON "MarketSettlementLog"("questionId");

-- CreateIndex
CREATE INDEX "Position_marketId_idx" ON "Position"("marketId");

-- CreateIndex
CREATE INDEX "Position_userId_idx" ON "Position"("userId");

-- CreateIndex
CREATE INDEX "Position_agentId_idx" ON "Position"("agentId");

-- CreateIndex
CREATE INDEX "Position_address_idx" ON "Position"("address");

-- CreateIndex
CREATE INDEX "Trade_marketId_idx" ON "Trade"("marketId");

-- CreateIndex
CREATE INDEX "Trade_marketId_outcomeIndex_idx" ON "Trade"("marketId", "outcomeIndex");

-- CreateIndex
CREATE INDEX "Trade_userId_idx" ON "Trade"("userId");

-- CreateIndex
CREATE INDEX "Trade_agentId_idx" ON "Trade"("agentId");

-- CreateIndex
CREATE INDEX "Order_marketId_idx" ON "Order"("marketId");

-- CreateIndex
CREATE INDEX "Order_marketId_outcomeIndex_idx" ON "Order"("marketId", "outcomeIndex");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_agentId_idx" ON "Order"("agentId");

-- CreateIndex
CREATE INDEX "News_marketId_idx" ON "News"("marketId");

-- CreateIndex
CREATE INDEX "FeedItem_source_idx" ON "FeedItem"("source");

-- CreateIndex
CREATE INDEX "FeedItem_publishedAt_idx" ON "FeedItem"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedItem_source_externalId_key" ON "FeedItem"("source", "externalId");

-- CreateIndex
CREATE INDEX "AiLog_agentId_idx" ON "AiLog"("agentId");

-- CreateIndex
CREATE INDEX "AiLog_marketId_idx" ON "AiLog"("marketId");

-- CreateIndex
CREATE INDEX "AgentReasoning_agentId_idx" ON "AgentReasoning"("agentId");

-- CreateIndex
CREATE INDEX "AgentReasoning_marketId_idx" ON "AgentReasoning"("marketId");

-- CreateIndex
CREATE INDEX "AgentReasoning_createdAt_idx" ON "AgentReasoning"("createdAt");

-- CreateIndex
CREATE INDEX "AiRequest_userId_idx" ON "AiRequest"("userId");

-- CreateIndex
CREATE INDEX "Activity_agentId_idx" ON "Activity"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRegistration_claimCode_key" ON "AgentRegistration"("claimCode");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRegistration_claimedAgentId_key" ON "AgentRegistration"("claimedAgentId");

-- CreateIndex
CREATE INDEX "AgentRegistration_apiKeyHash_idx" ON "AgentRegistration"("apiKeyHash");

-- CreateIndex
CREATE INDEX "AgentRegistration_claimCode_idx" ON "AgentRegistration"("claimCode");

-- CreateIndex
CREATE INDEX "AgentRegistration_status_idx" ON "AgentRegistration"("status");

-- AddForeignKey
ALTER TABLE "UserVault" ADD CONSTRAINT "UserVault_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChainBalance" ADD CONSTRAINT "AgentChainBalance_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAgentTrade" ADD CONSTRAINT "PendingAgentTrade_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingAgentTrade" ADD CONSTRAINT "PendingAgentTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEnqueuedMarket" ADD CONSTRAINT "AgentEnqueuedMarket_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentEnqueuedMarket" ADD CONSTRAINT "AgentEnqueuedMarket_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentOpenClaw" ADD CONSTRAINT "AgentOpenClaw_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStrategy" ADD CONSTRAINT "AgentStrategy_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTrack" ADD CONSTRAINT "AgentTrack_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketSettlementLog" ADD CONSTRAINT "MarketSettlementLog_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "News" ADD CONSTRAINT "News_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiLog" ADD CONSTRAINT "AiLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiLog" ADD CONSTRAINT "AiLog_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReasoning" ADD CONSTRAINT "AgentReasoning_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReasoning" ADD CONSTRAINT "AgentReasoning_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRequest" ADD CONSTRAINT "AiRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRegistration" ADD CONSTRAINT "AgentRegistration_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRegistration" ADD CONSTRAINT "AgentRegistration_claimedAgentId_fkey" FOREIGN KEY ("claimedAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
