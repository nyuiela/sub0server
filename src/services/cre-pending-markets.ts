/**
 * Pending CRE markets: after sending createMarket to CRE, we store payloads and poll
 * the Sub0 contract getMarket(questionId) after 10–20s. When the market exists on-chain,
 * we persist it to the DB.
 */

import { createPublicClient, http, type Hex } from "viem";
import { sepolia } from "viem/chains";
import contractsData from "../lib/contracts.json" with { type: "json" };
import { config } from "../config/index.js";
import { getPrismaClient } from "../lib/prisma.js";
import { computeQuestionId } from "../lib/cre-question-id.js";
import { createPlatformPositionsForMarket } from "./platform-positions.service.js";
import { broadcastMarketUpdate, MARKET_UPDATE_REASON } from "../lib/broadcast-market.js";
import { seedMarketLiquidityOnChain } from "./seed-market-liquidity.service.js";
import type { CreCreateMarketPayload } from "../types/agent-markets.js";

const USDC_DECIMALS = 6;

const POLL_DELAY_MS = 15_000;
const MAX_PENDING_AGE_MS = 120_000;

const SUB0_ADDRESS =
  (contractsData as { contracts?: { sub0?: string } }).contracts?.sub0 ??
  "0x45bec1219aE7442C93CBB32d63Df374d94e1df2A";

interface PendingItem {
  questionId: Hex;
  question: string;
  creatorAddress: string;
  oracle: string;
  duration: number;
  outcomeSlotCount: number;
  oracleType: number;
  marketType: number;
  agentSource?: string;
  sentAt: number;
}

const pending: PendingItem[] = [];

const SUB0_GET_MARKET_ABI = [
  {
    type: "function" as const,
    name: "getMarket",
    inputs: [{ name: "questionId", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct Sub0.Market",
        components: [
          { name: "question", type: "string", internalType: "string" },
          { name: "conditionId", type: "bytes32", internalType: "bytes32" },
          { name: "oracle", type: "address", internalType: "address" },
          { name: "owner", type: "address", internalType: "address" },
          { name: "createdAt", type: "uint256", internalType: "uint256" },
          { name: "duration", type: "uint256", internalType: "uint256" },
          { name: "outcomeSlotCount", type: "uint256", internalType: "uint256" },
          { name: "oracleType", type: "uint8", internalType: "enum Sub0.OracleType" },
          { name: "marketType", type: "uint8", internalType: "enum Sub0.MarketType" },
        ],
      },
    ],
    stateMutability: "view" as const,
  },
] as const;

let publicClient: ReturnType<typeof createPublicClient> | null = null;

function getClient(): ReturnType<typeof createPublicClient> | null {
  const rpcUrl = config.chainRpcUrl;
  if (!rpcUrl) return null;
  if (publicClient === null) {
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    });
  }
  return publicClient;
}

export function addPending(payloads: CreCreateMarketPayload[]): void {
  const now = Date.now();
  for (const p of payloads) {
    const questionId = computeQuestionId(p.question, p.creatorAddress, p.oracle) as Hex;
    pending.push({
      questionId,
      question: p.question,
      creatorAddress: p.creatorAddress,
      oracle: p.oracle,
      duration: p.duration,
      outcomeSlotCount: p.outcomeSlotCount,
      oracleType: p.oracleType,
      marketType: p.marketType,
      agentSource: p.agentSource,
      sentAt: now,
    });
  }
}

function getPendingToPoll(): PendingItem[] {
  const now = Date.now();
  return pending.filter(
    (item) => item.sentAt <= now - POLL_DELAY_MS && item.sentAt >= now - MAX_PENDING_AGE_MS
  );
}

function removePending(questionId: Hex): void {
  const idx = pending.findIndex((p) => p.questionId.toLowerCase() === questionId.toLowerCase());
  if (idx >= 0) pending.splice(idx, 1);
}

async function persistMarketFromChain(
  item: PendingItem,
  chainMarket: {
    question: string;
    conditionId: Hex;
    oracle: string;
    owner: string;
    createdAt: bigint;
    duration: bigint;
    outcomeSlotCount: number | bigint;
    oracleType: number;
    marketType: number;
  }
): Promise<void> {
  const prisma = getPrismaClient();
  const conditionId = chainMarket.conditionId as string;
  const existing = await prisma.market.findUnique({
    where: { conditionId },
    select: { id: true },
  });
  if (existing) {
    removePending(item.questionId);
    return;
  }
  const outcomeCount = Number(chainMarket.outcomeSlotCount);
  const resolutionDate = new Date(Date.now() + Number(chainMarket.duration) * 1000);
  const outcomes =
    outcomeCount === 2
      ? ["Yes", "No"]
      : Array.from({ length: outcomeCount }, (_, i) => `Outcome ${i + 1}`);
  const market = await prisma.market.create({
    data: {
      name: chainMarket.question,
      creatorAddress: chainMarket.owner,
      context: null,
      outcomes: outcomes as object,
      resolutionDate,
      oracleAddress: chainMarket.oracle,
      collateralToken: config.defaultCollateralToken,
      conditionId,
      questionId: item.questionId,
      platform: "NATIVE",
      agentSource: item.agentSource ?? null,
    },
  });
  const outcomePositionIds = market.outcomePositionIds as string[] | null;
  await createPlatformPositionsForMarket(
    market.id,
    outcomeCount,
    market.collateralToken,
    Array.isArray(outcomePositionIds) ? outcomePositionIds : null
  );

  const amountUsdcRaw = config.platformSeedAmountUsdcRaw;
  const seeded = await seedMarketLiquidityOnChain(item.questionId, amountUsdcRaw);
  const initialVolume =
    seeded ? rawUsdcToDecimalString(amountUsdcRaw) : "0";
  if (seeded) {
    await prisma.market.update({
      where: { id: market.id },
      data: { volume: initialVolume },
    });
  }

  await broadcastMarketUpdate({
    marketId: market.id,
    reason: MARKET_UPDATE_REASON.CREATED,
    volume: initialVolume,
  });
  removePending(item.questionId);
}

function rawUsdcToDecimalString(raw: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;
  const fracStr = fracPart.toString().padStart(USDC_DECIMALS, "0").slice(0, 8);
  return fracStr === "0".repeat(8) ? intPart.toString() : `${intPart}.${fracStr}`;
}

export async function runPoll(): Promise<void> {
  const client = getClient();
  if (!client) return;
  const toPoll = getPendingToPoll();
  for (const item of toPoll) {
    try {
      const result = await client.readContract({
        address: SUB0_ADDRESS as Hex,
        abi: SUB0_GET_MARKET_ABI,
        functionName: "getMarket",
        args: [item.questionId],
      });
      const zeroCondition = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
      if (result.conditionId !== zeroCondition && result.conditionId != null) {
        await persistMarketFromChain(item, result);
      }
    } catch {
      // not yet on chain or RPC error; keep in pending
    }
  }
  const tooOld = Date.now() - MAX_PENDING_AGE_MS;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].sentAt < tooOld) pending.splice(i, 1);
  }
}
