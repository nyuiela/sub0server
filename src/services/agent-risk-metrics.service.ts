/**
 * Compute and persist agent risk metrics (maxDrawdown, winRate) from historical tracks and trades.
 */

import Decimal from "decimal.js";
import { getPrismaClient } from "../lib/prisma.js";
import type { PrismaClient } from "@prisma/client";

/**
 * Recompute maxDrawdown and winRate for an agent from AgentTrack (and optionally Trade) data,
 * then update the Agent record. Use after new trades or track entries.
 */
export async function calculateAgentRiskMetrics(
  agentId: string,
  client?: PrismaClient
): Promise<void> {
  const prisma = client ?? getPrismaClient();
  const tracks = await prisma.agentTrack.findMany({
    where: { agentId },
    orderBy: { date: "asc" },
    select: { pnl: true },
  });

  let peak = new Decimal(0);
  let maxDrawdown = new Decimal(0);
  let wins = 0;
  for (let i = 0; i < tracks.length; i++) {
    const pnl = new Decimal(tracks[i]!.pnl.toString());
    if (pnl.gt(peak)) peak = pnl;
    const dd = peak.minus(pnl);
    if (dd.gt(maxDrawdown)) maxDrawdown = dd;
    if (i > 0 && pnl.gt(new Decimal(tracks[i - 1]!.pnl.toString()))) wins++;
  }
  const total = tracks.length > 1 ? tracks.length - 1 : 0;
  const winRate = total > 0 ? wins / total : 0;

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      maxDrawdown: maxDrawdown.toFixed(18),
      winRate,
    },
  });
}
