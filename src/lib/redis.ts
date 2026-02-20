import { Redis } from "ioredis";
import { config } from "../config/index.js";

let publisher: Redis | null = null;
let subscriber: Redis | null = null;

function createRedisClient(): Redis {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 100, 3000),
  });
}

export async function getRedisPublisher(): Promise<Redis> {
  if (publisher === null) {
    publisher = createRedisClient();
  }
  return publisher;
}

export async function getRedisSubscriber(): Promise<Redis> {
  if (subscriber === null) {
    subscriber = createRedisClient();
  }
  return subscriber;
}

export async function getRedisConnection(): Promise<Redis> {
  return getRedisPublisher();
}

export async function closeRedis(): Promise<void> {
  if (publisher !== null) {
    await publisher.quit();
    publisher = null;
  }
  if (subscriber !== null) {
    await subscriber.quit();
    subscriber = null;
  }
}

