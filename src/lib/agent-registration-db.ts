/**
 * Typed accessor for AgentRegistration model.
 * Use this so TypeScript sees the delegate when the generated client is in a non-standard path (e.g. pnpm store).
 */

import type { PrismaClient } from "@prisma/client";
import { getPrismaClient } from "./prisma.js";

/** Delegate for AgentRegistration; args match Prisma API. */
export type AgentRegistrationDelegate = {
  findUnique: (args: { where: { id?: string; claimCode?: string; apiKeyHash?: string }; select?: Record<string, boolean> }) => Promise<Record<string, unknown> | null>;
  create: (args: { data: Record<string, unknown>; select?: Record<string, boolean> }) => Promise<{ id: string }>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
};

function getDelegate(): AgentRegistrationDelegate {
  const prisma = getPrismaClient() as PrismaClient & { agentRegistration: AgentRegistrationDelegate };
  return prisma.agentRegistration;
}

export function getAgentRegistrationModel(): AgentRegistrationDelegate {
  return getDelegate();
}
