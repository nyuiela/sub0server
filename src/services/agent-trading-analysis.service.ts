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

function isRecoverableProviderError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("rate limit") ||
    m.includes("resource has been exhausted") ||
    m.includes("monthly spending limit") ||
    m.includes("no grok/xai api key configured") ||
    m.includes("no gemini trading key configured")
  );
}

export interface SimulationContext {
  /** Evaluate market as of this date (ISO). Agent must not use information after this. */
  asOfDate: string;
  dateRangeEnd: string;
  dateRangeStart?: string;
}

export interface AgentPositionSummary {
  outcomeIndex: number;
  side: string;
  quantity: string;
}

export interface AgentMarketContext {
  marketName: string;
  outcomes: string[];
  agentName: string;
  personaSummary?: string;
  /** Agent's selected model id; determines provider and API key (Gemini keys vs XAI). */
  model?: string;
  /** When set (simulate), agent must limit reasoning to information available on or before asOfDate. */
  simulationContext?: SimulationContext;
  /** Current open positions in this market (LONG/SHORT per outcome). Used to decide hold, add, or close. */
  currentPositions?: AgentPositionSummary[];
}

export interface TradingDecision {
  action: "skip" | "buy" | "sell";
  outcomeIndex?: number;
  quantity?: string;
  reason?: string;
  /** When to run analysis again (ms from now). Optional; e.g. 3600000 = 1h, 86400000 = 24h. */
  nextFollowUpInMs?: number;
  /** Full LLM response text for debugging and storage */
  fullResponse?: string;
  /** Raw prompt sent to LLM */
  prompt?: string;
}

function buildPrompt(ctx: AgentMarketContext): string {
  const outcomeList = ctx.outcomes.map((o, i) => `  ${i}: ${o}`).join("\n");
  const simBlock =
    ctx.simulationContext != null
      ? `
SIMULATION MODE (STRICT):
- You are evaluating this market AS OF ${ctx.simulationContext.asOfDate}. Only use information that would have been available on or before this date.
- The market may since have resolved; do NOT use knowledge of the resolution or any event after this date.
- Your goal is to show how you would have traded when the market was active. Base your decision only on what was knowable by ${ctx.simulationContext.asOfDate}.
`
      : "";
  const posBlock =
    ctx.currentPositions != null && ctx.currentPositions.length > 0
      ? `\nYOUR CURRENT POSITIONS IN THIS MARKET:\n${ctx.currentPositions.map((p) => `  outcome ${p.outcomeIndex} ${p.side}: ${p.quantity} shares`).join("\n")}\n- You can skip (hold), buy (add LONG or reduce SHORT), or sell (reduce LONG or close). If you sell, quantity must not exceed your LONG position for that outcome.`
      : "\nYOUR CURRENT POSITIONS IN THIS MARKET: None (no open positions).\n- You can skip (hold), or buy to open a position.";

  const isGrok = ctx.model && isGrokModel(ctx.model);
  const searchInstruction = isGrok ? `
INTERNET SEARCH ENABLED: You have access to real-time internet search. USE IT to research:
- Recent news, events, and developments related to this market
- Expert opinions and analysis
- Historical data and trends
- Social media sentiment and discussions
- Any relevant information that could impact the outcome

RESEARCH STRATEGY:
1. Search for recent news about the market topic
2. Look for expert predictions and analysis
3. Check social media for sentiment
4. Consider historical patterns
5. Make an informed trading decision based on your research` : "";

  return `You are an expert prediction market trader with deep analytical capabilities. Your goal is to make informed trading decisions based on thorough research and analysis.${simBlock}

MARKET: ${ctx.marketName}
OUTCOMES (index required for outcomeIndex):
${outcomeList}
${posBlock}
OUTCOME TEXT: ${ctx.outcomes.map((o, i) => `  ${i}: ${o}`).join("\n")}

AGENT: ${ctx.agentName}${ctx.personaSummary ? `\nPERSONA: ${ctx.personaSummary.slice(0, 2000)}` : ""}

${searchInstruction}

TRADING INSTRUCTIONS:
- Analyze the market thoroughly using all available information
- Consider both fundamental factors and market sentiment
- Look for edge cases and contrarian opportunities
- Provide detailed reasoning for your decision
- Default to trading rather than skipping - find opportunities others miss
- If you must skip, explain what information would make you trade

Respond with JSON only, no markdown:
{
  "action": "skip" | "buy" | "sell",
  "outcomeIndex": 0,
  "outcomeText": "outcome text",
  "quantity": "10",
  "reason": "detailed explanation of your analysis and decision (2-3 sentences)",
  "nextFollowUpInMs": 3600000
}
- If action is skip, outcomeIndex and quantity can be omitted (you are holding).
- If buy or sell: outcomeIndex must be a valid index (0 to ${Math.max(0, ctx.outcomes.length - 1)}), quantity a positive number string representing USDC amount (e.g. "5" for 5 USDC, "10" for 10 USDC, "20" for 20 USDC). For sell, do not exceed your LONG position for that outcome.
- nextFollowUpInMs (optional): when to re-run analysis (ms from now). E.g. 3600000 = 1h, 86400000 = 24h. Omit for default.`;
}

function parseTradingResponse(text: string, outcomeText: string, ctx: AgentMarketContext): TradingDecision {
  const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let parsed: {
    action?: string;
    outcomeIndex?: number;
    outcomeText?: string;
    quantity?: string;
    reason?: string;
    nextFollowUpInMs?: number;
  };
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
  const nextFollowUpInMs =
    typeof parsed.nextFollowUpInMs === "number" && parsed.nextFollowUpInMs > 0
      ? Math.min(parsed.nextFollowUpInMs, 7 * 24 * 3600 * 1000)
      : undefined;
  return {
    action,
    outcomeIndex,
    quantity: quantity && Number(quantity) > 0 ? quantity : undefined,
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : undefined,
    nextFollowUpInMs,
  };
}

async function callGeminiTrading(ctx: AgentMarketContext, model: string): Promise<{ text: string; outcomeText: string }> {
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
  const outcomeText = data?.candidates?.[0]?.content?.parts?.[1]?.text?.trim();
  if (!text) throw new Error("Empty Gemini response");
  if (!outcomeText) throw new Error("Empty Gemini outcome text");
  return { text, outcomeText };
}

async function callGrokTrading(ctx: AgentMarketContext, model: string): Promise<{ text: string; outcomeText: string }> {
  const apiKey = getNextGrokKey() ?? config.grokApiKey;
  if (!apiKey?.trim()) {
    throw new Error("No Grok/XAI API key configured");
  }
  
  const prompt = buildPrompt(ctx);
  
  const res = await fetch(XAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
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
  const content = data?.choices?.[0]?.message?.content?.trim();
  
  if (!content) throw new Error("Empty Grok response");
  
  // Parse the content to extract both text and outcome
  const text = content;
  const outcomeText = content; // For now, use same content for both
  
  return { text, outcomeText };
}

export async function runTradingAnalysis(ctx: AgentMarketContext): Promise<TradingDecision> {
  const effectiveModel = (ctx.model?.trim() || DEFAULT_MODEL).toLowerCase();
  const prompt = buildPrompt(ctx);

  const withDebug = (decision: TradingDecision, fullResponse: string): TradingDecision => ({
    ...decision,
    fullResponse,
    prompt,
  });

  try {
    let text: string;
    let outcomeText: string;
    if (isGrokModel(effectiveModel)) {
      try {
        const result = await callGrokTrading(ctx, effectiveModel);
        text = result.text;
        outcomeText = result.outcomeText;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isRecoverableProviderError(msg)) throw err;
        const fallback = await callGeminiTrading(ctx, DEFAULT_MODEL);
        text = fallback.text;
        outcomeText = fallback.outcomeText;
      }
    } else if (isGeminiModel(effectiveModel)) {
      try {
        const result = await callGeminiTrading(ctx, effectiveModel);
        text = result.text;
        outcomeText = result.outcomeText;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isRecoverableProviderError(msg)) throw err;
        const fallbackModel = config.grokModel || "grok-3-mini";
        const fallback = await callGrokTrading(ctx, fallbackModel);
        text = fallback.text;
        outcomeText = fallback.outcomeText;
      }
    } else {
      const result = await callGeminiTrading(ctx, DEFAULT_MODEL);
      text = result.text;
      outcomeText = result.outcomeText;
    }
    
    const decision = parseTradingResponse(text, outcomeText, ctx);
    return withDebug(decision, text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("No Gemini trading key") ||
      message.includes("No Grok/XAI") ||
      isRecoverableProviderError(message)
    ) {
      return {
        action: "skip",
        reason: message,
        fullResponse: `Error: ${message}`,
        prompt,
      };
    }
    return {
      action: "skip",
      reason: `Trading analysis failed: ${message}`,
      fullResponse: `Error: ${message}`,
      prompt,
    };
  }
}
