/**
 * Agent trading analysis: LLM (Gemini trading keys) decides whether to trade on a market.
 * Used by the agent worker for scout→analyze→trade. Returns action (skip | buy | sell), outcomeIndex, quantity.
 */

import { getNextGeminiKeyTrading, recordRateLimit } from "../lib/llm-rotation.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.0-flash";

export interface AgentMarketContext {
  marketName: string;
  outcomes: string[];
  agentName: string;
  personaSummary?: string;
}

export interface TradingDecision {
  action: "skip" | "buy" | "sell";
  outcomeIndex?: number;
  quantity?: string;
  reason?: string;
}

function buildPrompt(ctx: AgentMarketContext): string {
  const outcomeList = ctx.outcomes.map((o, i) => `  ${i}: ${o}`).join("\n");
  return `You are a prediction market trading agent. Given the market and your persona, decide whether to trade.

MARKET: ${ctx.marketName}
OUTCOMES (index required for outcomeIndex):
${outcomeList}

AGENT: ${ctx.agentName}${ctx.personaSummary ? `\nPERSONA (summary): ${ctx.personaSummary.slice(0, 500)}` : ""}

Respond with JSON only, no markdown:
{
  "action": "skip" | "buy" | "sell",
  "outcomeIndex": 0,
  "quantity": "10",
  "reason": "one sentence"
}
- If action is skip, outcomeIndex and quantity can be omitted.
- If buy or sell: outcomeIndex must be a valid index (0 to ${Math.max(0, ctx.outcomes.length - 1)}), quantity a positive number string (e.g. "5" or "10").`;
}

export async function runTradingAnalysis(ctx: AgentMarketContext): Promise<TradingDecision> {
  const apiKey = getNextGeminiKeyTrading();
  if (!apiKey?.trim()) {
    return { action: "skip", reason: "No Gemini trading key configured" };
  }

  const url = `${GEMINI_URL}/${DEFAULT_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: buildPrompt(ctx) }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    if (res.status === 429) {
      recordRateLimit("gemini_trading");
    }
    const text = await res.text();
    throw new Error(`Gemini trading analysis error ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    return { action: "skip", reason: "Empty LLM response" };
  }

  let parsed: { action?: string; outcomeIndex?: number; quantity?: string; reason?: string };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    return { action: "skip", reason: "Invalid JSON from LLM" };
  }

  const action = parsed.action === "buy" || parsed.action === "sell" ? parsed.action : "skip";
  const outcomeIndex =
    typeof parsed.outcomeIndex === "number" && parsed.outcomeIndex >= 0 && parsed.outcomeIndex < ctx.outcomes.length
      ? parsed.outcomeIndex
      : undefined;
  const quantity =
    typeof parsed.quantity === "string" && parsed.quantity.trim() !== ""
      ? String(Number(parsed.quantity) || 0)
      : undefined;

  return {
    action,
    outcomeIndex,
    quantity: quantity && Number(quantity) > 0 ? quantity : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : undefined,
  };
}
