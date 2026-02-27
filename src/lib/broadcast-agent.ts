/**
 * Broadcast agent-related changes to frontends via Redis.
 * WebSocket service subscribes to AGENT_UPDATES and sends AGENT_UPDATED to room agent:{agentId}.
 */

import { getRedisPublisher } from "./redis.js";
import { REDIS_CHANNELS } from "../config/index.js";

export interface AgentUpdateBroadcastPayload {
  agentId: string;
  balance?: string;
  reason?: "balance";
}

/**
 * Publish an agent update to Redis. Subscribers to room agent:{agentId} receive AGENT_UPDATED.
 */
export async function broadcastAgentUpdate(payload: AgentUpdateBroadcastPayload): Promise<void> {
  const redis = await getRedisPublisher();
  await redis.publish(REDIS_CHANNELS.AGENT_UPDATES, JSON.stringify(payload));
}

/** Room name for an agent (use with SUBSCRIBE). */
export function agentRoom(agentId: string): string {
  return `agent:${agentId}`;
}
