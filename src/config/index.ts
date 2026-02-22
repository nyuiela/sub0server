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
    get corsOrigin(): string | true {
      const o = process.env.CORS_ORIGIN;
      if (o === "true" || o === "*") return true;
      return o ?? "http://localhost:3000";
    },
    /** Platform liquidity: address that holds positions used to fill MARKET orders. If unset, no platform fill. */
    get platformLiquidityAddress(): string | undefined {
      return process.env.PLATFORM_LIQUIDITY_ADDRESS ?? undefined;
    },
    /** Initial LONG size per outcome when creating platform positions on market create. */
    get platformInitialLiquidityPerOutcome(): number {
      return Number(optionalEnv("PLATFORM_INITIAL_LIQUIDITY_PER_OUTCOME", "10000"));
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
