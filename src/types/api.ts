export interface UserCreate {
  address: string;
  email?: string | null;
}

export interface UserUpdate {
  email?: string | null;
}

export interface AgentCreate {
  ownerId: string;
  name: string;
  persona: string;
  publicKey: string;
  encryptedPrivateKey: string;
  modelSettings: Record<string, unknown>;
  templateId?: string | null;
}

export interface AgentUpdate {
  name?: string;
  persona?: string;
  encryptedPrivateKey?: string;
  modelSettings?: Record<string, unknown>;
  status?: "ACTIVE" | "PAUSED" | "DEPLETED" | "EXPIRED";
  templateId?: string | null;
}

export interface MarketCreate {
  name: string;
  creatorAddress: string;
  context?: string | null;
  outcomes: unknown[];
  sourceUrl?: string | null;
  resolutionDate: string;
  oracleAddress: string;
  collateralToken: string;
  conditionId: string;
}

export interface MarketUpdate {
  name?: string;
  context?: string | null;
  outcomes?: unknown[];
  sourceUrl?: string | null;
  resolutionDate?: string;
  oracleAddress?: string;
  status?: "OPEN" | "RESOLVING" | "CLOSED" | "DISPUTED";
}

export interface PositionCreate {
  marketId: string;
  userId?: string | null;
  agentId?: string | null;
  address: string;
  tokenAddress: string;
  outcomeIndex: number;
  side: "LONG" | "SHORT";
  avgPrice: string;
  collateralLocked: string;
  isAmm?: boolean;
}

export interface PositionUpdate {
  status?: "OPEN" | "CLOSED" | "LIQUIDATED";
}

export interface AgentStrategyCreate {
  agentId: string;
  preference?: "AMM_ONLY" | "ORDERBOOK" | "HYBRID";
  maxSlippage: number;
  spreadTolerance: number;
}

export interface AgentStrategyUpdate {
  preference?: "AMM_ONLY" | "ORDERBOOK" | "HYBRID";
  maxSlippage?: number;
  spreadTolerance?: number;
}

export interface ToolCreate {
  name: string;
  url: string;
  description: string;
  fee: string;
  receiverAddress: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  provider: string;
}

export interface ToolUpdate {
  name?: string;
  url?: string;
  description?: string;
  fee?: string;
  receiverAddress?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  provider?: string;
}
