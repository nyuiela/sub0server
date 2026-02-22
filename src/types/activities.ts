/**
 * Activity feed types: unified items from trades, positions, news, and agent activities.
 */

export const ACTIVITY_TYPES = ["trade", "position", "news", "agent_activity"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityTradePayload {
  type: "trade";
  id: string;
  marketId: string;
  outcomeIndex: number;
  userId: string | null;
  agentId: string | null;
  side: string;
  amount: string;
  price: string;
  txHash: string | null;
  createdAt: string;
}

export interface ActivityPositionPayload {
  type: "position";
  id: string;
  marketId: string;
  userId: string | null;
  agentId: string | null;
  address: string;
  side: string;
  status: string;
  avgPrice: string;
  collateralLocked: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityNewsPayload {
  type: "news";
  id: string;
  marketId: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  createdAt: string;
}

export interface ActivityAgentPayload {
  type: "agent_activity";
  id: string;
  agentId: string;
  activityType: string;
  payload: unknown;
  createdAt: string;
}

export type ActivityPayload =
  | ActivityTradePayload
  | ActivityPositionPayload
  | ActivityNewsPayload
  | ActivityAgentPayload;

export interface ActivityItem {
  id: string;
  type: ActivityType;
  createdAt: string;
  payload: ActivityPayload;
}

export interface ActivitiesQuery {
  marketId?: string;
  userId?: string;
  agentId?: string;
  positionId?: string;
  types?: string | ActivityType[];
  limit: number;
  offset: number;
}

export interface HolderSummary {
  userId: string | null;
  agentId: string | null;
  address: string;
  positionCount: number;
  openPositionCount: number;
}

export interface TraderSummary {
  userId: string | null;
  agentId: string | null;
  tradeCount: number;
  totalVolume: string;
}
