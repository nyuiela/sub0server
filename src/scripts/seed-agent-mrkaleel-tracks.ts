/**
 * Seed AgentTrack, AgentStrategy, and AgentReasoning for agent mrkaleel (0dbb4841-dd55-4ff6-9a36-d8a3cb53da98)
 * using only markets this agent has traded in.
 *
 * Run: pnpm run seed:agent-mrkaleel
 */

import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Decimal } from "decimal.js";

const AGENT_ID = "0dbb4841-dd55-4ff6-9a36-d8a3cb53da98";
const DAYS_TRACK = 14;
const REASONING_PER_MARKET_MIN = 2;
const REASONING_PER_MARKET_MAX = 6;

const connectionString = process.env.DATABASE_URL;
if (!connectionString?.trim()) {
  console.error("DATABASE_URL is required. Set it in .env or the environment.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

function toDecimal(v: string | number): string {
  return new Decimal(v).toString();
}

async function getMarketsAgentTraded(agentId: string): Promise<{ marketId: string; name: string | null }[]> {
  const trades = await prisma.trade.findMany({
    where: { agentId },
    select: { marketId: true },
    distinct: ["marketId"],
  });
  if (trades.length === 0) {
    return [];
  }
  const marketIds = trades.map((t) => t.marketId);
  const markets = await prisma.market.findMany({
    where: { id: { in: marketIds } },
    select: { id: true, name: true },
  });
  return markets.map((m) => ({ marketId: m.id, name: m.name }));
}

async function seedAgentStrategy(agentId: string): Promise<void> {
  await prisma.agentStrategy.upsert({
    where: { agentId },
    update: {},
    create: {
      agentId,
      preference: "HYBRID",
      maxSlippage: 0.015,
      spreadTolerance: 0.005,
    },
  });
  console.log("AgentStrategy upserted for agent", agentId);
}

async function seedAgentTracks(agentId: string): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (let d = 0; d <= DAYS_TRACK; d++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - (DAYS_TRACK - d));
    date.setUTCHours(0, 0, 0, 0);

    const volume = 50 + Math.random() * 200;
    const trades = Math.floor(2 + Math.random() * 6);
    const pnl = (Math.random() - 0.45) * 40;
    const exposure = 20 + Math.random() * 80;
    const drawdown = Math.random() * 15;
    const llmTokensUsed = 800 + Math.floor(Math.random() * 2200);
    const inputT = Math.floor(llmTokensUsed * (0.7 + Math.random() * 0.2));
    const completionT = llmTokensUsed - inputT;
    const cost = (inputT / 1_000_000) * 5 + (completionT / 1_000_000) * 15;

    await prisma.agentTrack.upsert({
      where: { agentId_date: { agentId, date } },
      update: {},
      create: {
        agentId,
        date,
        volume: toDecimal(volume),
        trades,
        pnl: toDecimal(pnl),
        exposure: toDecimal(exposure),
        drawdown: toDecimal(drawdown),
        llmTokensUsed,
        llmCost: toDecimal(cost),
      },
    });
  }
  console.log(`AgentTrack: ${DAYS_TRACK + 1} days seeded for agent`, agentId);
}

async function seedAgentReasoning(
  agentId: string,
  markets: { marketId: string; name: string | null }[]
): Promise<void> {
  const models = ["claude-3-5-sonnet", "gpt-4o", "gpt-4o-mini"];
  const actions = ["PLACED_LONG", "PLACED_SHORT", "SKIPPED", "CLOSED_POSITION"] as const;
  const reasons = [
    "Probability edge above threshold; placing limit buy. Risk score 0.6.",
    "Market sentiment bullish but order book spread too wide. Action: SKIP.",
    "Drawdown approaching limit. Reducing size. Action: CLOSED_POSITION.",
    "High conviction on outcome; increasing position. Risk score 0.55.",
    "Liquidity sufficient; executing at mid. Action: PLACED_LONG.",
  ];

  let created = 0;
  for (const { marketId, name } of markets) {
    const n = REASONING_PER_MARKET_MIN + Math.floor(Math.random() * (REASONING_PER_MARKET_MAX - REASONING_PER_MARKET_MIN + 1));
    for (let i = 0; i < n; i++) {
      const promptT = 600 + Math.floor(Math.random() * 1400);
      const completionT = 80 + Math.floor(Math.random() * 220);
      const totalT = promptT + completionT;
      const cost = (promptT / 1_000_000) * 5 + (completionT / 1_000_000) * 15;
      const reason = reasons[Math.floor(Math.random() * reasons.length)] ?? reasons[0];
      const action = actions[Math.floor(Math.random() * actions.length)] ?? "SKIPPED";

      await prisma.agentReasoning.create({
        data: {
          agentId,
          marketId,
          model: models[Math.floor(Math.random() * models.length)] ?? "claude-3-5-sonnet",
          systemPrompt: "You are a prediction market agent. Output JSON with action and reason.",
          userContext: `Market: ${name ?? marketId}. Mid 0.${45 + Math.floor(Math.random() * 10)}, spread 0.02, volume_24h ${5000 + Math.floor(Math.random() * 20000)}.`,
          reasoning: reason,
          response: JSON.stringify({ action, reason: reason.slice(0, 50) }),
          promptTokens: promptT,
          completionTokens: completionT,
          totalTokens: totalT,
          estimatedCost: toDecimal(cost),
          riskScore: 0.3 + Math.random() * 0.6,
          actionTaken: action,
          tradeReason: `Trade reason for ${name ?? marketId}: ${reason.slice(0, 80)}`,
        },
      });
      created++;
    }
  }
  console.log(`AgentReasoning: ${created} records created across ${markets.length} markets for agent`, agentId);
}

async function main(): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: AGENT_ID },
    select: { id: true, name: true },
  });
  if (!agent) {
    console.error("Agent not found:", AGENT_ID);
    process.exit(1);
  }
  console.log("Seeding for agent:", agent.name, agent.id);

  const markets = await getMarketsAgentTraded(AGENT_ID);
  if (markets.length === 0) {
    console.log("No markets found that this agent has traded. Seeding strategy and tracks only; reasoning will be skipped.");
  } else {
    console.log("Markets agent has traded:", markets.length, markets.map((m) => m.name ?? m.marketId).join(", "));
  }

  await seedAgentStrategy(AGENT_ID);
  await seedAgentTracks(AGENT_ID);
  if (markets.length > 0) {
    await seedAgentReasoning(AGENT_ID, markets);
  }

  console.log("Seed completed: AgentStrategy, AgentTrack" + (markets.length > 0 ? ", AgentReasoning" : ""));
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
