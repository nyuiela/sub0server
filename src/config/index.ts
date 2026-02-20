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
  };
}

export const config = makeConfig();

export const REDIS_CHANNELS = {
  PRICE_FEED: "price_feed",
  MARKET_UPDATES: "market_updates",
  TRADES: "trades",
} as const;

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const ROOM_PREFIX = "market:";
