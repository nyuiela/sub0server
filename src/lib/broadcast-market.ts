/**
 * Central helper to broadcast market-related changes to frontends via Redis.
 * All mutations that affect a market (create, update, delete, trades, positions, etc.)
 * should call this so WebSocket subscribers to market:{marketId} receive MARKET_UPDATED.
 */

import { getRedisPublisher } from "./redis.js";
import { REDIS_CHANNELS, ROOM_PREFIX } from "../config/index.js";

export const MARKET_UPDATE_REASON = {
  CREATED: "created",
  UPDATED: "updated",
  DELETED: "deleted",
  STATS: "stats",
  POSITION: "position",
  ORDERBOOK: "orderbook",
} as const;

export type MarketUpdateReason = (typeof MARKET_UPDATE_REASON)[keyof typeof MARKET_UPDATE_REASON];

export interface MarketUpdateBroadcastPayload {
  marketId: string;
  reason?: MarketUpdateReason;
  volume?: string;
}

/**
 * Publish a market update to Redis. WebSocket service subscribes and broadcasts
 * MARKET_UPDATED to room market:{marketId}. Frontend can refetch GET /api/markets/:id
 * or merge the payload.
 */
export async function broadcastMarketUpdate(payload: MarketUpdateBroadcastPayload): Promise<void> {
  const redis = await getRedisPublisher();
  await redis.publish(REDIS_CHANNELS.MARKET_UPDATES, JSON.stringify(payload));
}

/** Room name for a market (use with SUBSCRIBE). */
export function marketRoom(marketId: string): string {
  return `${ROOM_PREFIX}${marketId}`;
}
