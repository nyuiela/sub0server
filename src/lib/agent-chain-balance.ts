/**
 * Agent balance per trading place (main chain vs Tenderly simulate).
 * Reads/writes AgentChainBalance; falls back to Agent.balance for "main" when no row exists.
 */

import { getPrismaClient } from "./prisma.js";
import type { AgentChainKey } from "../types/agent-chain.js";
import { CHAIN_KEY_MAIN } from "../types/agent-chain.js";

export async function getAgentBalanceForChain(
  agentId: string,
  chainKey: AgentChainKey
): Promise<string> {
  const prisma = getPrismaClient();
  const row = await prisma.agentChainBalance.findUnique({
    where: { agentId_chainKey: { agentId, chainKey } },
    select: { balance: true },
  });
  if (row != null) return row.balance.toString();
  if (chainKey === CHAIN_KEY_MAIN) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { balance: true },
    });
    return agent?.balance?.toString() ?? "0";
  }
  return "0";
}

export async function upsertAgentChainBalance(
  agentId: string,
  chainKey: AgentChainKey,
  balance: string
): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.agentChainBalance.upsert({
    where: { agentId_chainKey: { agentId, chainKey } },
    create: { agentId, chainKey, balance },
    update: { balance },
  });
}
