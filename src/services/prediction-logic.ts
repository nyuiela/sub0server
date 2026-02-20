import type { MarketSnapshot, AgentPrediction, PriceTick } from "../types/prediction.js";

const MIN_CONFIDENCE = 0.3;
const MAX_CONFIDENCE = 0.95;
const DEFAULT_SIZE = 0.01;

export function evaluateMarketSentiment(
  snapshot: MarketSnapshot,
  recentTicks: PriceTick[],
  agentConfig: { riskAppetite?: number; maxPositionSize?: number } = {}
): AgentPrediction {
  const { riskAppetite = 0.5, maxPositionSize = 1 } = agentConfig;
  const trend = computeTrend(recentTicks);
  const momentum = computeMomentum(recentTicks);
  const meanReversion = 0.5 - snapshot.probability;
  const combined = trend * 0.4 + momentum * 0.3 + meanReversion * 0.3;
  const rawProbability = 0.5 + Math.max(-0.45, Math.min(0.45, combined));
  const probability = Math.max(0.05, Math.min(0.95, rawProbability));
  const confidence = MIN_CONFIDENCE + (MAX_CONFIDENCE - MIN_CONFIDENCE) * (1 - Math.abs(0.5 - probability) * 2);
  const side = probability > 0.5 ? "long" : "short";
  const size = Math.min(maxPositionSize, DEFAULT_SIZE * (1 + riskAppetite));
  const reasoning = buildReasoning(snapshot, trend, momentum, probability);
  return {
    probability,
    confidence,
    side,
    size,
    reasoning,
  };
}

function computeTrend(ticks: PriceTick[]): number {
  if (ticks.length < 2) return 0;
  const first = ticks[0]?.price ?? 0;
  const last = ticks[ticks.length - 1]?.price ?? 0;
  if (first === 0) return 0;
  return (last - first) / first;
}

function computeMomentum(ticks: PriceTick[]): number {
  if (ticks.length < 3) return 0;
  const half = Math.floor(ticks.length / 2);
  const firstHalf = ticks.slice(0, half);
  const secondHalf = ticks.slice(half);
  const avgFirst = firstHalf.reduce((s, t) => s + t.price, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, t) => s + t.price, 0) / secondHalf.length;
  if (avgFirst === 0) return 0;
  return (avgSecond - avgFirst) / avgFirst;
}

function buildReasoning(
  snapshot: MarketSnapshot,
  trend: number,
  momentum: number,
  probability: number
): string {
  const parts: string[] = [];
  if (Math.abs(trend) > 0.001) {
    parts.push(trend > 0 ? "uptrend" : "downtrend");
  }
  if (Math.abs(momentum) > 0.001) {
    parts.push(momentum > 0 ? "positive momentum" : "negative momentum");
  }
  parts.push(`probability ${probability.toFixed(2)}`);
  return parts.length > 0 ? parts.join("; ") : "neutral";
}

export function shouldExecuteTrade(
  prediction: AgentPrediction,
  threshold: number = 0.6
): boolean {
  return prediction.confidence >= threshold;
}
