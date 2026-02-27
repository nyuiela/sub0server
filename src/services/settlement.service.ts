/**
 * Settlement orchestration: find markets due for resolution, run two-agent deliberation,
 * persist log (and dispute reasons when no consensus), return outcome array for onchain resolve.
 */

import { getPrismaClient } from "../lib/prisma.js";
import { runTwoAgentDeliberation } from "./settlement-deliberation.service.js";
import type {
  SettlementDeliberationResponse,
  OutcomeArray,
} from "../types/settlement.js";

export interface MarketForSettlement {
  id: string;
  name: string;
  conditionId: string;
  resolutionDate: Date;
  status: string;
  outcomes: unknown;
  settlementRules: string | null;
}

/**
 * Find markets that are due for resolution (resolutionDate in the past, status OPEN).
 */
export async function findMarketsDueForSettlement(limit: number = 10): Promise<MarketForSettlement[]> {
  const prisma = getPrismaClient();
  const now = new Date();
  const markets = await prisma.market.findMany({
    where: {
      status: "OPEN",
      resolutionDate: { lt: now },
    },
    take: limit,
    orderBy: { resolutionDate: "asc" },
    select: {
      id: true,
      name: true,
      conditionId: true,
      resolutionDate: true,
      status: true,
      outcomes: true,
      settlementRules: true,
    },
  });
  return markets as MarketForSettlement[];
}

/**
 * Run deliberation for a single market and persist the log.
 * Returns outcome array and canResolve when consensus; otherwise stores dispute reasons.
 */
export async function deliberateAndPersist(
  marketId: string,
  questionId: string,
  question: string,
  outcomes: string[],
  settlementRules: string | null
): Promise<SettlementDeliberationResponse> {
  const deliberation = await runTwoAgentDeliberation({
    questionId,
    question,
    outcomes,
    rules: settlementRules ?? undefined,
  });

  const prisma = getPrismaClient();
  await prisma.marketSettlementLog.create({
    data: {
      marketId,
      questionId,
      consensus: deliberation.consensus,
      outcomeArray: deliberation.outcomeArray ? (deliberation.outcomeArray as unknown as object) : undefined,
      agentAReason: deliberation.disputeReasons?.agentA ?? deliberation.agentA?.reason ?? null,
      agentBReason: deliberation.disputeReasons?.agentB ?? deliberation.agentB?.reason ?? null,
    },
  });

  const canResolve =
    deliberation.consensus &&
    deliberation.outcomeArray != null &&
    deliberation.outcomeArray.length === outcomes.length &&
    deliberation.outcomeArray.some((v) => v === 1);

  return {
    canResolve,
    outcomeArray: canResolve && deliberation.outcomeArray != null ? deliberation.outcomeArray : null,
    outcomeString: deliberation.agentA?.outcomeString,
    deliberation,
  };
}

/**
 * Convert outcome array (0|1 per index) to payouts for onchain resolve.
 * [1,0] -> [1, 0], [1,1] -> [1, 1], [0,0] -> invalid (caller should not resolve).
 */
export function outcomeArrayToPayouts(outcomeArray: OutcomeArray): bigint[] {
  return outcomeArray.map((v) => (v === 1 ? 1n : 0n));
}
