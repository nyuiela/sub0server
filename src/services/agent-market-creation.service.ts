/**
 * Agent market creation: generates prediction market questions via Gemini and Grok (XAI).
 * Strict rules: current year, likely future events only. Each payload tagged with agentSource (gemini | grok).
 */

import { config } from "../config/index.js";
import type {
  AgentMarketSuggestion,
  CreCreateMarketPayload,
  AgentSource,
} from "../types/agent-markets.js";

const DEFAULT_DURATION_SECONDS = 86400;
const DEFAULT_OUTCOME_SLOT_COUNT = 2;
const ORACLE_TYPE_PLATFORM = 1;
const MARKET_TYPE_PUBLIC = 2;
const MAX_QUESTION_LENGTH = 256;
const CURRENT_YEAR = new Date().getFullYear();

function buildSystemPrompt(): string {
  return `You are a prediction market question generator. Your task is to output a JSON array of market questions.

STRICT RULES:
- Use ONLY the current year (${CURRENT_YEAR}) in any date or time reference. Do not use past years.
- Questions must be about events that are likely to occur or be verifiable in the future (e.g. "${CURRENT_YEAR} elections", "Will X happen by end of ${CURRENT_YEAR}?").
- Each question must be a single, clear yes/no or multi-outcome prediction.
- No historical or already-resolved events.
- No offensive or harmful content.

OUTPUT FORMAT:
- You MUST respond with a SINGLE JSON array. Each element is an object with:
  - "question": string (required). Clear prediction question. Max ${MAX_QUESTION_LENGTH} chars.
  - "durationSeconds": number (optional). Seconds until resolution. Default ${DEFAULT_DURATION_SECONDS}.
  - "outcomeSlotCount": number (optional). 2 for binary. Default ${DEFAULT_OUTCOME_SLOT_COUNT}.
- Output MUST be valid JSON only. No markdown, no code fences, no prose before or after.
- Minified (one line) preferred. Property order: "question" first, then "durationSeconds", then "outcomeSlotCount".
- Generate exactly the number of items requested (or up to 10 if not specified).`;
}

function buildUserPrompt(count: number): string {
  return `Generate exactly ${count} prediction market questions following the rules. Return only the JSON array.`;
}

async function callGemini(count: number): Promise<AgentMarketSuggestion[]> {
  const apiKey = config.geminiApiKey;
  if (!apiKey?.trim()) {
    throw new Error("GEMINI_API_KEY is not set; cannot generate agent markets");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildSystemPrompt() + "\n\n" + buildUserPrompt(count) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error("Gemini response missing text");
  }

  return parseSuggestionsFromText(text);
}

/** Grok (XAI) chat completions: https://api.x.ai/v1/chat/completions */
async function callGrok(count: number): Promise<AgentMarketSuggestion[]> {
  const apiKey = config.grokApiKey;
  if (!apiKey?.trim()) {
    return [];
  }

  const url = "https://api.x.ai/v1/chat/completions";
  const body = {
    model: config.grokModel,
    messages: [
      {
        role: "user",
        content:
          buildSystemPrompt() +
          "\n\n" +
          buildUserPrompt(count),
      },
    ],
    max_tokens: 8192,
    temperature: 0.7,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grok API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    return [];
  }

  return parseSuggestionsFromText(text);
}

function parseSuggestionsFromText(text: string): AgentMarketSuggestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) parsed = JSON.parse(match[0]);
    else return [];
  }

  if (!Array.isArray(parsed)) return [];

  const suggestions: AgentMarketSuggestion[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") continue;
    const q = (item as Record<string, unknown>).question;
    if (typeof q !== "string" || !q.trim()) continue;
    suggestions.push({
      question: q.trim().slice(0, MAX_QUESTION_LENGTH),
      durationSeconds:
        typeof (item as Record<string, unknown>).durationSeconds === "number"
          ? ((item as Record<string, unknown>).durationSeconds as number)
          : undefined,
      outcomeSlotCount:
        typeof (item as Record<string, unknown>).outcomeSlotCount === "number"
          ? ((item as Record<string, unknown>).outcomeSlotCount as number)
          : undefined,
    });
  }
  return suggestions;
}

function filterSuggestions(
  suggestions: AgentMarketSuggestion[]
): AgentMarketSuggestion[] {
  const yearPattern = /\b(19\d{2}|20[0-1]\d|202[0-4])\b/;
  return suggestions.filter((s) => {
    if (!s.question || s.question.length > MAX_QUESTION_LENGTH) return false;
    const hasPastYear = yearPattern.test(s.question);
    const hasCurrentYear = s.question.includes(String(CURRENT_YEAR));
    if (hasPastYear && !hasCurrentYear) return false;
    return true;
  });
}

function toCrePayload(
  suggestion: AgentMarketSuggestion,
  agentSource: AgentSource
): CreCreateMarketPayload {
  const duration =
    suggestion.durationSeconds != null && suggestion.durationSeconds > 0
      ? suggestion.durationSeconds
      : DEFAULT_DURATION_SECONDS;
  const outcomeSlotCount =
    suggestion.outcomeSlotCount != null &&
    suggestion.outcomeSlotCount >= 2 &&
    suggestion.outcomeSlotCount <= 255
      ? suggestion.outcomeSlotCount
      : DEFAULT_OUTCOME_SLOT_COUNT;

  return {
    action: "createMarket",
    question: suggestion.question,
    oracle: config.platformOracleAddress,
    duration,
    outcomeSlotCount,
    oracleType: ORACLE_TYPE_PLATFORM,
    marketType: MARKET_TYPE_PUBLIC,
    creatorAddress: config.platformCreatorAddress,
    agentSource,
  };
}

/**
 * Generates agent market payloads from both Gemini and Grok (if keys set).
 * Splits requested count between the two; each payload is tagged with agentSource.
 */
export async function generateAgentMarkets(
  count: number
): Promise<CreCreateMarketPayload[]> {
  const cap = Math.min(count, config.agentMarketsPerJob);
  if (cap < 1) return [];

  const half = Math.max(1, Math.floor(cap / 2));
  const geminiCount = half;
  const grokCount = cap - half;

  const [geminiSuggestions, grokSuggestions] = await Promise.all([
    callGemini(geminiCount),
    callGrok(grokCount),
  ]);

  const geminiFiltered = filterSuggestions(geminiSuggestions).slice(
    0,
    geminiCount
  );
  const grokFiltered = filterSuggestions(grokSuggestions).slice(0, grokCount);

  const out: CreCreateMarketPayload[] = [
    ...geminiFiltered.map((s) => toCrePayload(s, "gemini")),
    ...grokFiltered.map((s) => toCrePayload(s, "grok")),
  ];

  return out.slice(0, cap);
}
