-- RenameIndex
ALTER INDEX "idx_user_balance_token" RENAME TO "UserBalance_tokenAddress_idx";

-- RenameIndex
ALTER INDEX "idx_user_balance_user_id" RENAME TO "UserBalance_userId_idx";

-- RenameIndex
ALTER INDEX "idx_user_balance_user_token" RENAME TO "UserBalance_userId_tokenAddress_key";
