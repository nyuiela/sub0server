const requiredEnv = (key: string): string => {
  const value = process.env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
};

const optionalEnv = (key: string, fallback: string): string => {
  return process.env[key] ?? fallback;
};

function makeConfig() {
  return {
    get port(): number {
      return Number(optionalEnv("PORT", "3000"));
    },
    get nodeEnv(): string {
      return optionalEnv("NODE_ENV", "development");
    },
    get databaseUrl(): string {
      return requiredEnv("DATABASE_URL");
    },
    get redisUrl(): string {
      return requiredEnv("REDIS_URL");
    },
    get jwtSecret(): string {
      return requiredEnv("JWT_SECRET");
    },
    get binanceWsUrl(): string {
      return optionalEnv("BINANCE_WS_URL", "wss://stream.binance.com:9443/ws");
    },
    get appName(): string {
      return optionalEnv("APP_NAME", "sub0");
    },
    get challengeTtlSeconds(): number {
      return Number(optionalEnv("CHALLENGE_TTL_SECONDS", "300"));
    },
    get authDomain(): string {
      return optionalEnv("AUTH_DOMAIN", "localhost:3000");
    },
    get authCookieName(): string {
      return optionalEnv("AUTH_COOKIE_NAME", "sub0-auth-jwt");
    },
    get thirdwebSecretKey(): string | undefined {
      return process.env.THIRDWEB_SECRET_KEY ?? undefined;
    },
    get thirdwebAdminPrivateKey(): string | undefined {
      return process.env.THIRDWEB_ADMIN_PRIVATE_KEY ?? undefined;
    },
    get apiKey(): string | undefined {
      return process.env.API_KEY ?? undefined;
    },
    get agentEncryptionSecret(): string {
      return process.env.AGENT_ENCRYPTION_SECRET ?? requiredEnv("JWT_SECRET");
    },
    /** Comma-separated origins (e.g. "http://localhost:3000,http://localhost:3001"). "*" or "true" = allow all. */
    get corsOrigin(): string | string[] | true {
      const o = process.env.CORS_ORIGIN?.trim();
      if (o === "true" || o === "*") return true;
      const raw = o ?? "http://localhost:3000";
      const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
      return list.length > 1 ? list : list[0] ?? raw;
    },
    /** Platform liquidity: address that holds positions used to fill MARKET orders. If unset, no platform fill. */
    get platformLiquidityAddress(): string | undefined {
      return process.env.PLATFORM_LIQUIDITY_ADDRESS ?? undefined;
    },
    /** Initial LONG size per outcome when creating platform positions on market create. */
    get platformInitialLiquidityPerOutcome(): number {
      return Number(optionalEnv("PLATFORM_INITIAL_LIQUIDITY_PER_OUTCOME", "10000"));
    },
    /** News ingestion: poll interval in ms (default 10s). */
    get newsPollIntervalMs(): number {
      return Number(optionalEnv("NEWS_POLL_INTERVAL_MS", "10000"));
    },
    /** CryptoPanic API key (optional). When set, fetches from CryptoPanic in addition to RSS. */
    get cryptopanicApiKey(): string | undefined {
      return process.env.CRYPTOPANIC_API_KEY ?? undefined;
    },
    /** Comma-separated tickers to filter ingested items (e.g. BTC,ETH). Empty = no filter. */
    get newsFilterCurrencies(): string[] {
      const s = process.env.NEWS_FILTER_CURRENCIES?.trim();
      if (!s) return [];
      return s.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    },
    /** Agent market creation: max markets per cron/job (default 10). */
    get agentMarketsPerJob(): number {
      return Math.max(1, Math.min(50, Number(optionalEnv("AGENT_MARKETS_PER_JOB", "10"))));
    },
    /** Gemini API key for AI-generated market questions. Optional; if unset, agent-markets endpoint returns empty or errors. */
    get geminiApiKey(): string | undefined {
      return process.env.GEMINI_API_KEY ?? undefined;
    },
    /** Platform oracle address for agent-created markets (Sub0 oracle). */
    get platformOracleAddress(): string {
      return optionalEnv("PLATFORM_ORACLE_ADDRESS", "0x0000000000000000000000000000000000000000");
    },
    /** Platform creator address for agent-created markets (CRE signer / Sub0 owner). */
    get platformCreatorAddress(): string {
      return optionalEnv("PLATFORM_CREATOR_ADDRESS", "0x0000000000000000000000000000000000000000");
    },
    /** Default collateral token address for agent-created markets (e.g. USDC). */
    get defaultCollateralToken(): string {
      return optionalEnv("DEFAULT_COLLATERAL_TOKEN", "0x0000000000000000000000000000000000000000");
    },
    /** Gemini model for market generation (e.g. gemini-2.0-flash). */
    get geminiModel(): string {
      return optionalEnv("GEMINI_MODEL", "gemini-2.0-flash");
    },
    /** XAI API key (Grok is XAI; one key for both). Optional; if unset, only Gemini is used. */
    get grokApiKey(): string | undefined {
      return process.env.XAI_API_KEY ?? process.env.GROK_API_KEY ?? undefined;
    },
    /** Grok/XAI model name (e.g. grok-2-mini, grok-3-mini). XAI_MODEL or GROK_MODEL. */
    get grokModel(): string {
      return optionalEnv("XAI_MODEL", optionalEnv("GROK_MODEL", "grok-3-mini"));
    },
    /** Base URL for claim links (e.g. https://app.sub0.xyz). Used in BYOA registration response. */
    get frontendBaseUrl(): string {
      return optionalEnv("FRONTEND_URL", optionalEnv("AUTH_DOMAIN", "http://localhost:3000"));
    },
    /** Chain ID for SDK quote signing (e.g. 84532 Base Sepolia). When set with predictionVaultAddress, agent quote signing is enabled. */
    get sdkQuoteChainId(): number | undefined {
      const v = process.env.SDK_QUOTE_CHAIN_ID;
      return v !== undefined && v !== "" ? Number(v) : undefined;
    },
    /** PredictionVault address for EIP-712 quote signing. */
    get predictionVaultAddress(): string | undefined {
      return process.env.PREDICTION_VAULT_ADDRESS ?? undefined;
    },
    /** EIP-712 domain name for PredictionVault (e.g. Sub0PredictionVault). */
    get eip712DomainName(): string {
      return optionalEnv("EIP712_DOMAIN_NAME", "Sub0PredictionVault");
    },
    /** EIP-712 domain version (e.g. 1). */
    get eip712DomainVersion(): string {
      return optionalEnv("EIP712_DOMAIN_VERSION", "1");
    },
    /** CRE HTTP endpoint for triggering workflows (e.g. createAgentKey). When set, POST /api/agents/:id/create-wallet is enabled. */
    get creHttpUrl(): string | undefined {
      return process.env.CRE_HTTP_URL?.trim() || undefined;
    },
    /** API key sent to CRE HTTP trigger (body.apiKey). Must match CRE secret HTTP_API_KEY when set. */
    get creHttpApiKey(): string | undefined {
      return process.env.CRE_HTTP_API_KEY?.trim() || undefined;
    },
    /** If true, backend will POST createMarketsFromBackend to CRE on an interval (requires creHttpUrl). */
    get creMarketCronEnabled(): boolean {
      return process.env.CRE_MARKET_CRON_ENABLED === "true" || process.env.CRE_MARKET_CRON_ENABLED === "1";
    },
    /** Interval in ms for createMarketsFromBackend job (default 1 hour). */
    get creMarketCronIntervalMs(): number {
      return Math.max(60_000, Number(process.env.CRE_MARKET_CRON_INTERVAL_MS) || 3600_000);
    },
    /** If true, cron sends broadcast: true to CRE so simulate runs with --broadcast (real onchain txs). Set in sub0server .env (CRE_MARKET_CRON_BROADCAST=true). Default false = dry run, no tx hash. */
    get creMarketCronBroadcast(): boolean {
      return process.env.CRE_MARKET_CRON_BROADCAST === "true" || process.env.CRE_MARKET_CRON_BROADCAST === "1";
    },
  };
}

export const config = makeConfig();

export const REDIS_CHANNELS = {
  PRICE_FEED: "price_feed",
  MARKET_UPDATES: "market_updates",
  TRADES: "trades",
  ORDER_BOOK_UPDATE: "order_book_update",
} as const;

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const ROOM_PREFIX = "market:";
