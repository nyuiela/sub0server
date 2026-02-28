import contracts from "../lib/contracts.json" with { type: "json" };
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
    /** Domain used for Thirdweb JWT verification. Must match the frontend origin where the user signs in (e.g. localhost:3002 if app runs there). */
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
    /** Agent market creation: markets per agent per job (default 10). Each agent (Gemini, XAI, Open WebUI) generates this many; total = agents * this value, capped by service max (e.g. 50). */
    get agentMarketsPerJob(): number {
      return Math.max(1, Math.min(50, Number(optionalEnv("AGENT_MARKETS_PER_JOB", "10"))));
    },
    /** Gemini API key for AI-generated market questions. Optional; fallback if GEMINI_API_KEYS_* not set. */
    get geminiApiKey(): string | undefined {
      const list = this.geminiApiKeysMarketCreation;
      return list[0] ?? process.env.GEMINI_API_KEY ?? undefined;
    },
    /** Comma-separated Gemini keys for trading agents (analysis/orders). Fallback: GEMINI_API_KEY_TRADING_1,2,3 or GEMINI_API_KEY. */
    get geminiApiKeysTrading(): string[] {
      const csv = process.env.GEMINI_API_KEYS_TRADING?.trim();
      if (csv) return csv.split(",").map((k) => k.trim()).filter(Boolean);
      const k1 = process.env.GEMINI_API_KEY_TRADING_1?.trim();
      const k2 = process.env.GEMINI_API_KEY_TRADING_2?.trim();
      const k3 = process.env.GEMINI_API_KEY_TRADING_3?.trim();
      if (k1 || k2 || k3) return [k1, k2, k3].filter(Boolean) as string[];
      const single = process.env.GEMINI_API_KEY?.trim();
      return single ? [single] : [];
    },
    /** Comma-separated Gemini keys for market creation/listing. Fallback: GEMINI_API_KEY_MARKET_CREATION_1,2,3 or GEMINI_API_KEY_MARKET_1,2,3 or GEMINI_API_KEY. */
    get geminiApiKeysMarketCreation(): string[] {
      const csv = process.env.GEMINI_API_KEYS_MARKET_CREATION?.trim();
      if (csv) return csv.split(",").map((k) => k.trim()).filter(Boolean);
      const k1 =
        process.env.GEMINI_API_KEY_MARKET_CREATION_1?.trim() ??
        process.env.GEMINI_API_KEY_MARKET_1?.trim();
      const k2 =
        process.env.GEMINI_API_KEY_MARKET_CREATION_2?.trim() ??
        process.env.GEMINI_API_KEY_MARKET_2?.trim();
      const k3 =
        process.env.GEMINI_API_KEY_MARKET_CREATION_3?.trim() ??
        process.env.GEMINI_API_KEY_MARKET_3?.trim();
      if (k1 || k2 || k3) return [k1, k2, k3].filter(Boolean) as string[];
      const single = process.env.GEMINI_API_KEY?.trim();
      return single ? [single] : [];
    },
    /** Gemini models for listing/market creation (comma-separated or GEMINI_MODELS). First is primary. */
    get geminiModelsListing(): string[] {
      const csv = process.env.GEMINI_MODELS?.trim();
      if (csv) return csv.split(",").map((m) => m.trim()).filter(Boolean);
      const m = process.env.GEMINI_MODEL?.trim();
      return m ? [m] : [optionalEnv("GEMINI_MODEL", "gemini-2.0-flash")];
    },
    /** Platform oracle address for agent-created markets (Sub0 oracle). Must match chain; default matches sub0cre payloads/create-market-payload.json. */
    get platformOracleAddress(): string {
      return (
        process.env.PLATFORM_ORACLE_ADDRESS?.trim() ||
        contracts.platform?.oracleAddress
      );
    },
    /** Platform creator address for agent-created markets (CRE signer / Sub0 owner). Must match chain; default matches sub0cre payloads/create-market-payload.json. */
    get platformCreatorAddress(): string {
      return (
        process.env.PLATFORM_CREATOR_ADDRESS?.trim() ||
        contracts.platform?.creatorAddress
      );
    },
    /** Default USDC amount for agent-created market seed (CRE createMarket payload). Matches create-market-payload.json. */
    get agentMarketAmountUsdc(): string {
      return process.env.AGENT_MARKET_AMOUNT_USDC?.trim() || "1000000";
    },
    /** Default collateral token address for agent-created markets (e.g. USDC). */
    get defaultCollateralToken(): string {
      return optionalEnv("DEFAULT_COLLATERAL_TOKEN", contracts.contracts?.usdc);
    },
    /** RPC URL for Sub0 chain (e.g. Sepolia). When set, CRE pending markets are polled via getMarket(questionId) and persisted. */
    get chainRpcUrl(): string | undefined {
      return process.env.CHAIN_RPC_URL?.trim() || process.env.SEPOLIA_RPC_URL?.trim() || undefined;
    },
    /** Private key for signing chain txs (e.g. predictionVault.seedMarketLiquidity, agent ETH fund). Must hold ETH to fund new agent wallets. */
    get contractPrivateKey(): `0x${string}` | undefined {
      const k = process.env.CONTRACT_PRIVATE_KEY?.trim();
      return k?.startsWith("0x") ? (k as `0x${string}`) : k ? (`0x${k}` as `0x${string}`) : undefined;
    },
    /** ETH amount in wei to send to new agent wallet on onboarding (default 0.03 ETH). */
    get agentOnboardingEthWei(): bigint {
      const raw = process.env.AGENT_ONBOARDING_ETH_WEI?.trim();
      if (raw) {
        try {
          return BigInt(raw);
        } catch {
          // fallback
        }
      }
      return BigInt("30000000000000000"); // 0.03 ETH
    },
    /** USDC amount for predictionVault.seedMarketLiquidity in smallest units (6 decimals). Use PLATFORM_INITIAL_LIQUIDITY_RAW for raw bigint, else PLATFORM_INITIAL_LIQUIDITY_PER_OUTCOME (number) * 10^6. Capped to avoid contract reverts from absurd env values. */
    get platformSeedAmountUsdcRaw(): bigint {
      const MAX_SEED_RAW = BigInt(1e15);
      const defaultRaw = BigInt(Math.floor(this.platformInitialLiquidityPerOutcome)) * BigInt(1e6);
      const raw = process.env.PLATFORM_INITIAL_LIQUIDITY_RAW?.trim();
      if (raw) {
        try {
          const value = BigInt(raw);
          if (value <= MAX_SEED_RAW) return value;
          console.warn("[config] platformSeedAmountUsdcRaw capped: PLATFORM_INITIAL_LIQUIDITY_RAW too large (max 1e15 raw). Using default.");
          return defaultRaw;
        } catch {
          // fallback
        }
      }
      const perOutcome = process.env.PLATFORM_INITIAL_LIQUIDITY_PER_OUTCOME?.trim();
      if (perOutcome) {
        try {
          const n = Number(perOutcome);
          if (Number.isFinite(n) && n >= 0) {
            const value = BigInt(Math.floor(n)) * BigInt(1e6);
            if (value <= MAX_SEED_RAW) return value;
            console.warn("[config] platformSeedAmountUsdcRaw capped: PLATFORM_INITIAL_LIQUIDITY_PER_OUTCOME too large (max 1e9 USDC). Using default.");
            return defaultRaw;
          }
          const value = BigInt(perOutcome);
          if (value <= MAX_SEED_RAW) return value;
          console.warn("[config] platformSeedAmountUsdcRaw capped: PLATFORM_INITIAL_LIQUIDITY_PER_OUTCOME raw value too large. Using default.");
          return defaultRaw;
        } catch {
          try {
            const value = BigInt(perOutcome);
            if (value <= MAX_SEED_RAW) return value;
            console.warn("[config] platformSeedAmountUsdcRaw capped: raw value too large. Using default.");
            return defaultRaw;
          } catch {
            // fallback
          }
        }
      }
      return defaultRaw;
    },
    /** Gemini model for market generation (primary; first of geminiModelsListing). */
    get geminiModel(): string {
      return this.geminiModelsListing[0] ?? optionalEnv("GEMINI_MODEL", "gemini-2.0-flash");
    },
    /** XAI API keys (comma-separated or single XAI_API_KEY). Optional; if unset, only Gemini is used. */
    get grokApiKeys(): string[] {
      const csv = process.env.XAI_API_KEYS?.trim();
      if (csv) return csv.split(",").map((k) => k.trim()).filter(Boolean);
      const single = process.env.XAI_API_KEY ?? process.env.GROK_API_KEY ?? undefined;
      return single?.trim() ? [single.trim()] : [];
    },
    get grokApiKey(): string | undefined {
      return this.grokApiKeys[0] ?? undefined;
    },
    /** XAI/Grok models (comma-separated XAI_MODELS or XAI_MODEL_1/2/3 or single XAI_MODEL). */
    get grokModels(): string[] {
      const csv = process.env.XAI_MODELS?.trim();
      if (csv) return csv.split(",").map((m) => m.trim()).filter(Boolean);
      const m1 = process.env.XAI_MODEL_1?.trim();
      const m2 = process.env.XAI_MODEL_2?.trim();
      const m3 = process.env.XAI_MODEL_3?.trim();
      if (m1 || m2 || m3) return [m1, m2, m3].filter(Boolean) as string[];
      const m = process.env.XAI_MODEL ?? process.env.GROK_MODEL;
      return m?.trim() ? [m.trim()] : [optionalEnv("XAI_MODEL", optionalEnv("GROK_MODEL", "grok-3-mini"))];
    },
    get grokModel(): string {
      return this.grokModels[0] ?? optionalEnv("XAI_MODEL", optionalEnv("GROK_MODEL", "grok-3-mini"));
    },
    /** Open WebUI (OpenUI) base URL for market creation and optional trading (e.g. https://ai.example.com). When set, agent markets can use this as a third source. */
    get openWebUiBaseUrl(): string | undefined {
      const u = process.env.OPENWEBUI_BASE_URL?.trim();
      return u ? u.replace(/\/$/, "") : undefined;
    },
    /** Open WebUI API key (Bearer). Optional; if unset, Open WebUI is not used. */
    get openWebUiApiKey(): string | undefined {
      return process.env.OPENWEBUI_API_KEY?.trim() || undefined;
    },
    /** Open WebUI model name (e.g. gpt-oss:20b, llama3). */
    get openWebUiModel(): string {
      return process.env.OPENWEBUI_MODEL?.trim() || "gpt-oss:20b";
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
    /** If true (default), cron generates markets (agents * agentMarketsPerJob) and sends them in the request body so CRE batches all on-chain in one run with one batch callback. If false, CRE fetches via GET (cap 4 per run). */
    get creMarketCronBatchPayload(): boolean {
      return process.env.CRE_MARKET_CRON_BATCH_PAYLOAD !== "false" && process.env.CRE_MARKET_CRON_BATCH_PAYLOAD !== "0";
    },
    /** Backend base URL for worker to call POST /api/orders. Default: same host as this server (port from PORT). Backend typically runs on 4000. */
    get backendUrl(): string {
      return process.env.BACKEND_URL?.trim() || `http://localhost:${this.port}`;
    },
    /** If true, agent worker runs scout→analyze→trade (LLM + POST /api/orders). If false, worker only logs the job. */
    get agentTradingEnabled(): boolean {
      return process.env.AGENT_TRADING_ENABLED === "true" || process.env.AGENT_TRADING_ENABLED === "1";
    },
  };
}

export const config = makeConfig();

export const REDIS_CHANNELS = {
  PRICE_FEED: "price_feed",
  MARKET_UPDATES: "market_updates",
  TRADES: "trades",
  ORDER_BOOK_UPDATE: "order_book_update",
  AGENT_UPDATES: "agent_updates",
} as const;

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const ROOM_PREFIX = "market:";
