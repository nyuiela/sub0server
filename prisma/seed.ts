import { PrismaClient } from "@prisma/client";
import { faker } from "@faker-js/faker";
import Decimal from "decimal.js";
import { calculateAgentRiskMetrics } from "../src/services/agent-risk-metrics.service.js";

const prisma = new PrismaClient();

const KALEEL_USER_ID = "61fc7bb0-1f16-489e-a33b-02e9f5dba08f";
const KALEEL_ADDRESS = "0xb5f8ce5fb26e32b033333937d8a22aa7e4557d9b";
const PLACEHOLDER_ETH_ADDRESS = "0x0000000000000000000000000000000000000001";
const PLACEHOLDER_CONDITION_ID = "0x0000000000000000000000000000000000000000000000000000000000000001";
const SEED_AGENT_PUBLIC_KEY = "0x1111111111111111111111111111111111111111";
const SEED_AGENT_ENCRYPTED_KEY = "seed-encrypted-placeholder";

const INPUT_COST_PER_1M = 5.0;
const OUTPUT_COST_PER_1M = 15.0;

function toDecimal(v: string | number): string {
  return new Decimal(v).toFixed(18);
}

async function seedKaleelUser(): Promise<{ id: string; address: string }> {
  const user = await prisma.user.upsert({
    where: { id: KALEEL_USER_ID },
    update: { username: "kaleel", address: KALEEL_ADDRESS },
    create: {
      id: KALEEL_USER_ID,
      username: "kaleel",
      address: KALEEL_ADDRESS,
      authMethod: "WALLET",
    },
  });
  return { id: user.id, address: user.address };
}

async function seedUsers(): Promise<{ id: string }[]> {
  const user1 = await prisma.user.upsert({
    where: { address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD01" },
    update: {},
    create: {
      address: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD01",
      username: "alice",
      email: "alice@example.com",
      imageUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=alice",
      authMethod: "WALLET",
    },
  });
  const user2 = await prisma.user.upsert({
    where: { address: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199" },
    update: {},
    create: {
      address: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199",
      username: "bob",
      email: "bob@example.com",
      imageUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=bob",
      authMethod: "WALLET",
    },
  });
  return [user1, user2];
}

async function seedTemplates(): Promise<void> {
  const templates = [
    { id: "00000000-0000-0000-0000-000000000001", name: "Conservative Trader", persona: "Risk-averse agent. Prefer small positions and strict stop-losses.", seed: "conservative", strategy: "AMM_ONLY" },
    { id: "00000000-0000-0000-0000-000000000002", name: "Active Speculator", persona: "Seek high conviction markets and larger size when edge is clear.", seed: "speculator", strategy: "HYBRID" },
    { id: "00000000-0000-0000-0000-000000000003", name: "Balanced", persona: "Mix of AMM and orderbook; moderate risk.", seed: "balanced", strategy: "HYBRID" },
  ];
  for (const t of templates) {
    await prisma.template.upsert({
      where: { id: t.id },
      update: {},
      create: {
        id: t.id,
        name: t.name,
        persona: t.persona,
        imageUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${t.seed}`,
        config: { maxSlippage: 0.01, strategy: t.strategy },
      },
    });
  }
}

const MARKET_CONDITIONS = [
  { cid: PLACEHOLDER_CONDITION_ID, name: "Will BTC exceed $100k by end of 2025?", context: "Bitcoin price prediction", seed: "btc", resolution: "2025-12-31T23:59:59Z" },
  { cid: "0x0000000000000000000000000000000000000000000000000000000000000002", name: "Ethereum merge success before Oct 2025", context: "ETH merge outcome", seed: "eth", resolution: "2025-10-01T00:00:00Z" },
  { cid: "0x0000000000000000000000000000000000000000000000000000000000000003", name: "Will SOL hit $300 in 2025?", context: "Solana price", seed: "sol", resolution: "2025-12-31T23:59:59Z" },
  { cid: "0x0000000000000000000000000000000000000000000000000000000000000004", name: "Fed rate cut in June 2025?", context: "Macro", seed: "fed", resolution: "2025-06-30T23:59:59Z" },
];

async function seedMarkets(creatorAddress: string): Promise<{ id: string }[]> {
  const out: { id: string }[] = [];
  for (const m of MARKET_CONDITIONS) {
    const created = await prisma.market.upsert({
      where: { conditionId: m.cid },
      update: {},
      create: {
        name: m.name,
        creatorAddress,
        context: m.context,
        imageUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${m.seed}`,
        outcomes: ["Yes", "No"],
        resolutionDate: new Date(m.resolution),
        oracleAddress: PLACEHOLDER_ETH_ADDRESS,
        collateralToken: "0x0000000000000000000000000000000000000000",
        conditionId: m.cid,
        status: "OPEN",
      },
    });
    out.push(created);
  }
  return out;
}

const AGENT_SEEDS = [
  { id: "a1000000-0000-0000-0000-000000000001", name: "Kaleel Conservative", templateId: "00000000-0000-0000-0000-000000000001", pref: "AMM_ONLY" as const, slippage: 0.005, spread: 0.003 },
  { id: "a1000000-0000-0000-0000-000000000002", name: "Kaleel Speculator", templateId: "00000000-0000-0000-0000-000000000002", pref: "HYBRID" as const, slippage: 0.02, spread: 0.008 },
  { id: "a1000000-0000-0000-0000-000000000003", name: "Kaleel Balanced", templateId: "00000000-0000-0000-0000-000000000003", pref: "HYBRID" as const, slippage: 0.01, spread: 0.005 },
  { id: "a1000000-0000-0000-0000-000000000004", name: "Kaleel Orderbook", templateId: "00000000-0000-0000-0000-000000000002", pref: "ORDERBOOK" as const, slippage: 0.015, spread: 0.004 },
];

async function seedAgents(ownerId: string): Promise<{ id: string }[]> {
  const out: { id: string }[] = [];
  for (const a of AGENT_SEEDS) {
    const agent = await prisma.agent.upsert({
      where: { id: a.id },
      update: { ownerId },
      create: {
        id: a.id,
        ownerId,
        name: a.name,
        persona: `Seed agent: ${a.name}.`,
        publicKey: SEED_AGENT_PUBLIC_KEY,
        encryptedPrivateKey: SEED_AGENT_ENCRYPTED_KEY,
        modelSettings: {},
        templateId: a.templateId,
      },
    });
    await prisma.agentStrategy.upsert({
      where: { agentId: agent.id },
      update: {},
      create: {
        agentId: agent.id,
        preference: a.pref,
        maxSlippage: a.slippage,
        spreadTolerance: a.spread,
      },
    });
    out.push(agent);
  }
  return out;
}

function randomWalkPnl(days: number, volatility: number): { pnl: number[]; drawdown: number[] } {
  const pnl: number[] = [0];
  let peak = 0;
  const drawdown: number[] = [0];
  for (let i = 1; i <= days; i++) {
    const step = (faker.number.float({ min: -1, max: 1, fractionDigits: 4 }) * volatility);
    pnl.push(pnl[i - 1]! + step);
    peak = Math.max(peak, pnl[i]!);
    drawdown.push(Math.max(0, peak - pnl[i]!));
  }
  return { pnl, drawdown };
}

async function seedAgentHistory(
  agentId: string,
  marketIds: string[],
  daysBack: number = 30
): Promise<void> {
  const { pnl, drawdown } = randomWalkPnl(daysBack, 12);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  startDate.setUTCHours(0, 0, 0, 0);

  let totalLlmTokens = 0;
  let totalLlmCost = new Decimal(0);
  let maxDrawdown = new Decimal(0);
  let cumulativeExposure = new Decimal(0);

  for (let d = 0; d <= daysBack; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    date.setUTCHours(0, 0, 0, 0);

    const volume = faker.number.float({ min: 0, max: 500, fractionDigits: 2 });
    const trades = faker.number.int({ min: 0, max: 8 });
    const exposure = faker.number.float({ min: 0, max: 200, fractionDigits: 2 });
    const llmTokensUsed = faker.number.int({ min: 500, max: 3500 });
    const inputTokens = faker.number.int({ min: 400, max: 1800 });
    const outputTokens = llmTokensUsed - inputTokens;
    const cost = (inputTokens / 1_000_000) * INPUT_COST_PER_1M + (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M;

    totalLlmTokens += llmTokensUsed;
    totalLlmCost = totalLlmCost.plus(cost);
    const dd = new Decimal(drawdown[d] ?? 0);
    if (dd.gt(maxDrawdown)) maxDrawdown = dd;
    cumulativeExposure = cumulativeExposure.plus(exposure);

    await prisma.agentTrack.upsert({
      where: { agentId_date: { agentId, date } } as unknown as Parameters<typeof prisma.agentTrack.upsert>[0]["where"],
      update: {},
      create: {
        agentId,
        date,
        volume: toDecimal(volume),
        trades,
        pnl: toDecimal(pnl[d] ?? 0),
        exposure: toDecimal(exposure),
        drawdown: toDecimal(drawdown[d] ?? 0),
        llmTokensUsed,
        llmCost: toDecimal(cost),
      } as Parameters<typeof prisma.agentTrack.create>[0]["data"],
    });

    const logsPerDay = faker.number.int({ min: 5, max: 10 });
    const reasoningRepo = (prisma as unknown as { agentReasoning: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } }).agentReasoning;
    for (let i = 0; i < logsPerDay; i++) {
      const promptT = faker.number.int({ min: 500, max: 2000 });
      const completionT = faker.number.int({ min: 50, max: 300 });
      const marketId = marketIds[faker.number.int({ min: 0, max: marketIds.length - 1 })] ?? null;
      await reasoningRepo.create({
        data: {
          agentId,
          marketId: marketId ?? undefined,
          model: faker.helpers.arrayElement(["claude-3-5-sonnet", "gpt-4o", "gpt-4o-mini"]),
          systemPrompt: "You are a prediction market agent. Output JSON with action and reason.",
          userContext: `Market data: mid=0.${faker.number.int({ min: 40, max: 60 })}, spread=0.0${faker.number.int({ min: 1, max: 5 })}, volume_24h=${faker.number.int({ min: 1000, max: 50000 })}.`,
          reasoning: faker.helpers.arrayElement([
            "Market sentiment is bullish based on recent news, but order book spread is too wide. Risk score is 0.8. Action: SKIP.",
            "Probability edge above threshold. Placing limit buy at 0.48. Risk score 0.6.",
            "Drawdown approaching limit. Reducing size. Action: CLOSED_POSITION.",
          ]),
          response: JSON.stringify({ action: "SKIPPED", reason: "spread" }),
          promptTokens: promptT,
          completionTokens: completionT,
          totalTokens: promptT + completionT,
          estimatedCost: toDecimal(
            (promptT / 1_000_000) * INPUT_COST_PER_1M + (completionT / 1_000_000) * OUTPUT_COST_PER_1M
          ),
          riskScore: faker.number.float({ min: 0.3, max: 0.95, fractionDigits: 2 }),
          actionTaken: faker.helpers.arrayElement(["PLACED_LONG", "SKIPPED", "CLOSED_POSITION", "PLACED_SHORT"]),
        },
      });
    }
  }

  const tracks = await prisma.agentTrack.findMany({ where: { agentId }, select: { volume: true, trades: true } });
  let totalVolume = new Decimal(0);
  let totalTradesCount = 0;
  for (const t of tracks) {
    totalVolume = totalVolume.plus(t.volume.toString());
    totalTradesCount += t.trades;
  }
  const currentExposure = faker.number.float({ min: 0, max: 150, fractionDigits: 2 });
  const balance = faker.number.float({ min: 50, max: 500, fractionDigits: 2 });
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      balance: toDecimal(balance),
      tradedAmount: totalVolume.toFixed(18),
      totalTrades: totalTradesCount,
      totalLlmTokens,
      totalLlmCost: totalLlmCost.toFixed(18),
      currentExposure: toDecimal(currentExposure),
      maxDrawdown: maxDrawdown.toFixed(18),
      pnl: toDecimal(pnl[daysBack] ?? 0),
    } as Parameters<typeof prisma.agent.update>[0]["data"],
  });
}

async function seedActivities(agentIds: string[]): Promise<void> {
  const types = ["TRADE", "POSITION_OPEN", "POSITION_CLOSE", "SIGNAL", "LLM_CALL", "RISK_ALERT"];
  for (const agentId of agentIds) {
    const n = faker.number.int({ min: 8, max: 20 });
    for (let i = 0; i < n; i++) {
      await prisma.activity.create({
        data: {
          agentId,
          type: faker.helpers.arrayElement(types),
          payload: { at: new Date().toISOString(), detail: faker.lorem.sentence() },
        },
      });
    }
  }
}

async function seedAiLogs(agentIds: string[], marketIds: string[]): Promise<void> {
  const actions = ["ANALYZE", "DECISION", "ORDER_PLACED", "ORDER_CANCELLED", "ERROR"];
  for (const agentId of agentIds) {
    const n = faker.number.int({ min: 5, max: 15 });
    for (let i = 0; i < n; i++) {
      const marketId = faker.datatype.boolean(0.7) ? faker.helpers.arrayElement(marketIds) : undefined;
      await prisma.aiLog.create({
        data: {
          agentId,
          marketId: marketId ?? undefined,
          action: faker.helpers.arrayElement(actions),
          payload: { ts: Date.now(), reason: faker.lorem.sentence() },
        },
      });
    }
  }
}

async function seedAiRequests(userId: string): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await prisma.aiRequest.create({
      data: {
        userId,
        prompt: faker.lorem.sentence() + " " + faker.lorem.paragraph(),
        response: faker.datatype.boolean(0.8) ? faker.lorem.paragraph() : null,
      },
    });
  }
}

async function seedFeedItems(): Promise<void> {
  const items = [
    { source: "RSS_COINDESK", externalId: "cd-1", title: "Bitcoin ETF flows surge", body: "Summary.", publishedAt: new Date() },
    { source: "RSS_COINDESK", externalId: "cd-2", title: "Ethereum upgrade timeline", body: "Summary.", publishedAt: new Date(Date.now() - 86400000) },
    { source: "CRYPTOPANIC", externalId: "cp-1", title: "Market sentiment update", body: "Summary.", publishedAt: new Date(Date.now() - 172800000) },
  ];
  const feedRepo = (prisma as unknown as { feedItem: { upsert: (args: unknown) => Promise<unknown> } }).feedItem;
  for (const it of items) {
    await feedRepo.upsert({
      where: { source_externalId: { source: it.source, externalId: it.externalId } },
      update: {},
      create: {
        source: it.source,
        externalId: it.externalId,
        title: it.title,
        body: it.body,
        sourceUrl: "https://example.com/feed",
        publishedAt: it.publishedAt,
        metadata: { currencies: ["BTC"], kind: "news" },
      },
    });
  }
}

async function seedNews(marketIds: string[]): Promise<void> {
  const titles = ["Institutional adoption update", "Technical analysis", "Regulatory roundup", "On-chain metrics"];
  for (let i = 0; i < marketIds.length; i++) {
    const marketId = marketIds[i]!;
    await prisma.news.create({
      data: {
        marketId,
        title: titles[i] ?? titles[0]!,
        body: faker.lorem.paragraph(),
        sourceUrl: "https://example.com/news",
      },
    });
  }
}

async function seedOrders(marketIds: string[]): Promise<void> {
  for (const marketId of marketIds) {
    await prisma.order.create({
      data: {
        marketId,
        outcomeIndex: 0,
        side: "BUY",
        type: "LIMIT",
        amount: toDecimal(faker.number.float({ min: 10, max: 100, fractionDigits: 2 })),
        price: toDecimal(faker.number.float({ min: 0.3, max: 0.7, fractionDigits: 2 })),
        status: faker.helpers.arrayElement(["PENDING", "FILLED", "CANCELLED"]),
      } as Parameters<typeof prisma.order.create>[0]["data"],
    });
  }
}

async function seedPositions(marketIds: string[], agentIds: string[], userAddress: string): Promise<void> {
  for (const marketId of marketIds) {
    const agentId = faker.helpers.arrayElement(agentIds);
    await prisma.position.create({
      data: {
        marketId,
        agentId,
        address: userAddress,
        tokenAddress: PLACEHOLDER_ETH_ADDRESS,
        outcomeIndex: 0,
        side: faker.helpers.arrayElement(["LONG", "SHORT"]),
        status: faker.helpers.arrayElement(["OPEN", "OPEN", "CLOSED"]),
        avgPrice: toDecimal(faker.number.float({ min: 0.4, max: 0.6, fractionDigits: 2 })),
        collateralLocked: toDecimal(faker.number.float({ min: 20, max: 200, fractionDigits: 2 })),
        isAmm: faker.datatype.boolean(0.5),
      },
    });
  }
}

async function seedTrades(marketIds: string[], agentIds: string[]): Promise<void> {
  for (const marketId of marketIds.slice(0, 3)) {
    for (let i = 0; i < 4; i++) {
      await prisma.trade.create({
        data: {
          marketId,
          outcomeIndex: 0,
          agentId: faker.helpers.arrayElement(agentIds),
          side: faker.helpers.arrayElement(["BUY", "SELL"]),
          amount: toDecimal(faker.number.float({ min: 5, max: 50, fractionDigits: 2 })),
          price: toDecimal(faker.number.float({ min: 0.35, max: 0.65, fractionDigits: 2 })),
          txHash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
        },
      });
    }
  }
}

async function seedTools(): Promise<void> {
  const toolInputSchema = { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] };
  const toolOutputSchema = { type: "object", properties: { txHash: { type: "string" } } };
  await prisma.tool.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Placeholder Tool",
      url: "https://api.example.com/tool",
      description: "Seed tool for development.",
      imageUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=tool1",
      fee: 0.001,
      receiverAddress: PLACEHOLDER_ETH_ADDRESS,
      inputSchema: toolInputSchema,
      outputSchema: toolOutputSchema,
      provider: "sub0",
    },
  });
  await prisma.tool.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Market Order Tool",
      url: "https://api.example.com/market-order",
      description: "Place market order on prediction market.",
      fee: toDecimal(0.002),
      receiverAddress: PLACEHOLDER_ETH_ADDRESS,
      inputSchema: toolInputSchema,
      outputSchema: toolOutputSchema,
      provider: "sub0",
    },
  });
}

async function main() {
  await seedUsers();
  const kaleel = await seedKaleelUser();
  await seedTemplates();
  await seedTools();

  const markets = await seedMarkets(kaleel.address);
  const marketIds = markets.map((m) => m.id);

  const agents = await seedAgents(kaleel.id);
  const agentIds = agents.map((a) => a.id);

  for (const agent of agents) {
    await seedAgentHistory(agent.id, marketIds);
    await calculateAgentRiskMetrics(agent.id, prisma);
  }

  await seedActivities(agentIds);
  await seedAiLogs(agentIds, marketIds);
  await seedAiRequests(kaleel.id);
  await seedFeedItems();
  await seedNews(marketIds);
  await seedOrders(marketIds);
  await seedPositions(marketIds, agentIds, kaleel.address);
  await seedTrades(marketIds, agentIds);

  console.log("Seed completed: kaleel user, templates, tools, markets, agents (with strategy/tracks/reasoning), activities, aiLogs, aiRequests, feedItems, news, orders, positions, trades.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
