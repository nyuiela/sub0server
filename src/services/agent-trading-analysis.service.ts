/**
 * Agent trading analysis: LLM (Gemini or Grok, key chosen by agent model) decides whether to trade.
 * Used by the agent worker for scout→analyze→trade. Returns action (skip | buy | sell), outcomeIndex, quantity.
 */

import { config } from "../config/index.js";
import { getNextGeminiKeyTrading, getNextGrokKey, recordRateLimit } from "../lib/llm-rotation.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "gemini-2.0-flash";

function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini-");
}

function isGrokModel(model: string): boolean {
  return model.startsWith("grok-");
}

export interface AgentMarketContext {
  marketName: string;
  outcomes: string[];
  agentName: string;
  personaSummary?: string;
  /** Agent's selected model id; determines provider and API key (Gemini keys vs XAI). */
  model?: string;
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

function parseTradingResponse(text: string, ctx: AgentMarketContext): TradingDecision {
  const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: { action?: string; outcomeIndex?: number; quantity?: string; reason?: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
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

async function callGeminiTrading(ctx: AgentMarketContext, model: string): Promise<string> {
  const apiKey = getNextGeminiKeyTrading();
  if (!apiKey?.trim()) {
    throw new Error("No Gemini trading key configured");
  }
  const url = `${GEMINI_URL}/${model}:generateContent?key=${apiKey}`;
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
    if (res.status === 429) recordRateLimit("gemini_trading");
    const text = await res.text();
    throw new Error(`Gemini trading analysis error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Empty Gemini response");
  return text;
}

async function callGrokTrading(ctx: AgentMarketContext, model: string): Promise<string> {
  const apiKey = getNextGrokKey() ?? config.grokApiKey;
  if (!apiKey?.trim()) {
    throw new Error("No Grok/XAI API key configured");
  }
  const res = await fetch(XAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: buildPrompt(ctx) }],
      max_tokens: 512,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    if (res.status === 429) {
      recordRateLimit("grok_key");
    }
    const text = await res.text();
    throw new Error(`Grok trading analysis error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty Grok response");
  return text;
}

export async function runTradingAnalysis(ctx: AgentMarketContext): Promise<TradingDecision> {
  const effectiveModel = (ctx.model?.trim() || DEFAULT_MODEL).toLowerCase();

  try {
    let text: string;
    if (isGrokModel(effectiveModel)) {
      text = await callGrokTrading(ctx, effectiveModel);
    } else if (isGeminiModel(effectiveModel)) {
      text = await callGeminiTrading(ctx, effectiveModel);
    } else {
      text = await callGeminiTrading(ctx, DEFAULT_MODEL);
    }
    return parseTradingResponse(text, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No Gemini trading key") || message.includes("No Grok/XAI")) {
      return { action: "skip", reason: message };
    }
    throw err;
  }
}
