import { randomBytes } from "crypto";
import { getRedisConnection } from "../lib/redis.js";
import { config } from "../config/index.js";

const REDIS_KEY_PREFIX = "register:nonce:";
const REDIS_USED_PREFIX = "register:used:";

function generateNonce(): string {
  return randomBytes(24).toString("hex");
}

export function buildVerificationMessage(nonce: string, address: string): string {
  const appName = config.appName;
  const expires = new Date(Date.now() + config.challengeTtlSeconds * 1000).toISOString();
  return `${appName} registration\n\nAddress: ${address}\nNonce: ${nonce}\nExpires: ${expires}`;
}

export async function createChallenge(address: string): Promise<{ message: string; nonce: string; expiresAt: string }> {
  const nonce = generateNonce();
  const message = buildVerificationMessage(nonce, address);
  const expiresAt = new Date(Date.now() + config.challengeTtlSeconds * 1000).toISOString();
  const redis = await getRedisConnection();
  const key = REDIS_KEY_PREFIX + nonce;
  await redis.setex(key, config.challengeTtlSeconds, address);
  return { message, nonce, expiresAt };
}

export async function consumeNonce(nonce: string): Promise<string | null> {
  const redis = await getRedisConnection();
  const key = REDIS_KEY_PREFIX + nonce;
  const address = await redis.get(key);
  if (address === null) return null;
  await redis.del(key);
  const usedKey = REDIS_USED_PREFIX + nonce;
  await redis.setex(usedKey, config.challengeTtlSeconds * 2, address);
  return address;
}

export async function isNonceUsed(nonce: string): Promise<boolean> {
  const redis = await getRedisConnection();
  const exists = await redis.get(REDIS_USED_PREFIX + nonce);
  return exists !== null;
}

export async function getNonceAddress(nonce: string): Promise<string | null> {
  const redis = await getRedisConnection();
  return redis.get(REDIS_KEY_PREFIX + nonce);
}
