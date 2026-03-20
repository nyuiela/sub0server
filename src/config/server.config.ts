/**
 * Non-sensitive server defaults. All values here are safe to commit.
 * Sensitive data (keys, URLs, secrets) belongs in .env only.
 * config/index.ts reads these as fallbacks when env vars are not set.
 */

export const serverConfig = {
  // ─── Server ──────────────────────────────────────────────────────────────
  port: 3000,
  appName: "sub0",
  authCookieName: "sub0-auth-jwt",
  challengeTtlSeconds: 300,

  // ─── Timing & Polling ────────────────────────────────────────────────────
  newsPollIntervalMs: 100_000,
  creMarketCronIntervalMs: 3_600_000,
  triggerAllCronIntervalMs: 300_000,
  heartbeatIntervalMs: 30_000,

  // ─── Feature Flags ───────────────────────────────────────────────────────
  agentTradingEnabled: false,
  agentDiscoveryEnabled: true,
  agentMarketCreationFallbackDemo: false,
  triggerAllCronEnabled: false,
  triggerAllCreDelegated: false,
  creWorkerMode: false,
  creMarketCronEnabled: false,
  creMarketCronBroadcast: false,
  creMarketCronBatchPayload: true,

  // ─── Agent Limits ────────────────────────────────────────────────────────
  agentMarketsPerJob: 10,
  agentDiscoveryMaxNewPerAgent: 10,
  agentDiscoveryMarketsLimit: 50,

  // ─── Onboarding Amounts ──────────────────────────────────────────────────
  agentOnboardingEthWei: BigInt("30000000000000000"), // 0.03 ETH
  agentOnboardingUsdcAmount: 2_000_000n,             // 2 USDC (6 decimals)
  agentMarketAmountUsdc: "1000000",                   // 1 USDC seed
  platformInitialLiquidityPerOutcome: 1_000_000,

  // ─── AI Models ───────────────────────────────────────────────────────────
  geminiModel: "gemini-2.5-flash, gemini-2.5-flash",
  grokModel: "grok-3-mini, grok-4-1-fast-reasoning",
  openWebUiModel: "gpt-oss:20b",

  // ─── EIP-712 ─────────────────────────────────────────────────────────────
  eip712DomainName: "Sub0PredictionVault",
  eip712DomainVersion: "1",

  // ─── CRE Data Cache ──────────────────────────────────────────────────────
  macroCacheTtlMs: 300_000, // 5 min TTL for DataStreamsRegistry macro snapshots
} as const;

export type ServerConfig = typeof serverConfig;
