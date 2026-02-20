export interface MarketSnapshot {
  symbol: string;
  price: number;
  probability: number;
  poolLong: number;
  poolShort: number;
  recentTrades: { side: "long" | "short"; size: number; price: number }[];
}

export interface AgentPrediction {
  probability: number;
  confidence: number;
  side: "long" | "short";
  size: number;
  reasoning: string;
}

export interface PriceTick {
  symbol: string;
  price: number;
  timestamp: number;
}
