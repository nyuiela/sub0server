-- CreateTable for user balances
CREATE TABLE "UserBalance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenAddress" TEXT NOT NULL,
  "balance" DECIMAL(28,18) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserBalance_pkey" PRIMARY KEY ("id")
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_user_balance_user_id" ON "UserBalance"("userId");
CREATE INDEX IF NOT EXISTS "idx_user_balance_token" ON "UserBalance"("tokenAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_user_balance_user_token" ON "UserBalance"("userId","tokenAddress");

-- Add foreign key constraint
ALTER TABLE "UserBalance" ADD CONSTRAINT "UserBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
