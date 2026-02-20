import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PLACEHOLDER_ETH_ADDRESS = "0x0000000000000000000000000000000000000001";
const PLACEHOLDER_CONDITION_ID = "0x0000000000000000000000000000000000000000000000000000000000000001";
const SEED_AGENT_PUBLIC_KEY = "0x1111111111111111111111111111111111111111";
const SEED_AGENT_ENCRYPTED_KEY = "seed-encrypted-placeholder";

async function main() {
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

  const template1 = await prisma.template.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Conservative Trader",
      persona: "You are a risk-averse agent. Prefer small positions and strict stop-losses.",
      imageUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=conservative",
      config: { maxSlippage: 0.005, strategy: "AMM_ONLY" },
    },
  });

  const template2 = await prisma.template.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Active Speculator",
      persona: "You seek high conviction markets and larger size when edge is clear.",
      imageUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=speculator",
      config: { maxSlippage: 0.02, strategy: "HYBRID" },
    },
  });

  const market1 = await prisma.market.upsert({
    where: { conditionId: PLACEHOLDER_CONDITION_ID },
    update: {},
    create: {
      name: "Will BTC exceed $100k by end of 2025?",
      creatorAddress: user1.address,
      context: "Bitcoin price prediction",
      imageUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=btc",
      outcomes: ["Yes", "No"],
      resolutionDate: new Date("2025-12-31T23:59:59Z"),
      oracleAddress: PLACEHOLDER_ETH_ADDRESS,
      collateralToken: "0x0000000000000000000000000000000000000000",
      conditionId: PLACEHOLDER_CONDITION_ID,
      status: "OPEN",
    },
  });

  const market2ConditionId = "0x0000000000000000000000000000000000000000000000000000000000000002";
  const market2 = await prisma.market.upsert({
    where: { conditionId: market2ConditionId },
    update: {},
    create: {
      name: "Ethereum merge success before Oct 2025",
      creatorAddress: user2.address,
      context: "ETH merge outcome",
      imageUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=eth",
      outcomes: ["Yes", "No"],
      sourceUrl: "https://example.com/eth-merge",
      resolutionDate: new Date("2025-10-01T00:00:00Z"),
      oracleAddress: PLACEHOLDER_ETH_ADDRESS,
      collateralToken: "0x0000000000000000000000000000000000000000",
      conditionId: market2ConditionId,
      status: "OPEN",
    },
  });

  await prisma.news.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      marketId: market1.id,
      title: "Bitcoin institutional adoption update",
      body: "Summary of recent institutional flows and regulatory news.",
      imageUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=news1",
      sourceUrl: "https://example.com/btc-news",
    },
  });

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

  const agent = await prisma.agent.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      ownerId: user1.id,
      name: "Alice Agent",
      persona: "Seed agent for user alice.",
      publicKey: SEED_AGENT_PUBLIC_KEY,
      encryptedPrivateKey: SEED_AGENT_ENCRYPTED_KEY,
      modelSettings: {},
      templateId: template1.id,
    },
  });

  await prisma.agentStrategy.upsert({
    where: { agentId: agent.id },
    update: {},
    create: {
      agentId: agent.id,
      preference: "HYBRID",
      maxSlippage: 0.01,
      spreadTolerance: 0.005,
    },
  });

  console.log("Seed completed: users, templates, markets, news, tools, agent, agent strategy.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
