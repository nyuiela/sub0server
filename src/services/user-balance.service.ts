import { getPrismaClient } from "../lib/prisma.js";
import { Decimal } from "decimal.js";

export interface UserBalanceUpdate {
  userId: string;
  tokenAddress: string;
  amount: string;
  operation: 'deduct' | 'add';
  txHash?: string;
  reason?: string;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  tokenAddress: string;
  amount: string;
  operation: 'deduct' | 'add';
  txHash?: string;
  reason?: string;
  createdAt: Date;
}

/**
 * Update user balance with proper validation and transaction recording
 */
export async function updateUserBalance(update: UserBalanceUpdate): Promise<void> {
  const prisma = getPrismaClient();
  const { userId, tokenAddress, amount, operation, txHash, reason } = update;

  // Validate amount
  const amountDecimal = new Decimal(amount);
  if (amountDecimal.lte(0)) {
    throw new Error("Amount must be greater than 0");
  }

  // Get or create user balance record
  const existingBalance = await prisma.userBalance.findUnique({
    where: {
      userId_tokenAddress: {
        userId,
        tokenAddress,
      },
    },
  });

  if (!existingBalance) {
    // Create new balance record
    const initialBalance = operation === 'add' ? amountDecimal : new Decimal(0);
    await prisma.userBalance.create({
      data: {
        userId,
        tokenAddress,
        balance: initialBalance,
      },
    });
  } else {
    // Update existing balance
    const currentBalance = new Decimal(existingBalance.balance.toString());
    let newBalance: Decimal;

    if (operation === 'deduct') {
      if (currentBalance.lt(amountDecimal)) {
        throw new Error(`Insufficient balance. Current: ${currentBalance.toString()}, Required: ${amountDecimal.toString()}`);
      }
      newBalance = currentBalance.minus(amountDecimal);
    } else {
      newBalance = currentBalance.plus(amountDecimal);
    }

    await prisma.userBalance.update({
      where: {
        userId_tokenAddress: {
          userId,
          tokenAddress,
        },
      },
      data: {
        balance: newBalance,
        updatedAt: new Date(),
      },
    });
  }

  // Create transaction record (simplified - you might want a separate Transaction table)
  console.log(`User balance ${operation}: ${userId}, amount: ${amount}, token: ${tokenAddress}, txHash: ${txHash}, reason: ${reason}`);
}

/**
 * Get user balance for a specific token
 */
export async function getUserBalance(userId: string, tokenAddress: string): Promise<string> {
  const prisma = getPrismaClient();

  const balance = await prisma.userBalance.findUnique({
    where: {
      userId_tokenAddress: {
        userId,
        tokenAddress,
      },
    },
  });

  return balance?.balance.toString() || "0";
}

/**
 * Get all user balances
 */
export async function getAllUserBalances(userId: string): Promise<Array<{
  tokenAddress: string;
  balance: string;
  updatedAt: Date;
}>> {
  const prisma = getPrismaClient();

  const balances = await prisma.userBalance.findMany({
    where: { userId },
    select: {
      tokenAddress: true,
      balance: true,
      updatedAt: true,
    },
  });

  return balances.map(b => ({
    tokenAddress: b.tokenAddress,
    balance: b.balance.toString(),
    updatedAt: b.updatedAt,
  }));
}

/**
 * Check if user has sufficient balance
 */
export async function hasSufficientBalance(
  userId: string,
  tokenAddress: string,
  requiredAmount: string
): Promise<boolean> {
  const currentBalance = await getUserBalance(userId, tokenAddress);
  return new Decimal(currentBalance).gte(new Decimal(requiredAmount));
}
