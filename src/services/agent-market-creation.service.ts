/**
 * Agent market creation: generates prediction market questions via Gemini and Grok (XAI).
 * Strict rules: current year, likely future events only. Each payload tagged with agentSource (gemini | grok | openwebui).
 */

import { config } from "../config/index.js";
import {
  getNextGeminiKeyMarketCreation,
  getNextGeminiModelListing,
  getNextGrokKey,
  getNextGrokModel,
  recordRateLimit,
} from "../lib/llm-rotation.js";
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
  const apiKey = getNextGeminiKeyMarketCreation() ?? config.geminiApiKey;
  if (!apiKey?.trim()) {
    throw new Error(
      "GEMINI_API_KEY_MARKET_CREATION_1/2/3 or GEMINI_API_KEYS_MARKET_CREATION or GEMINI_API_KEY is not set; cannot generate agent markets"
    );
  }

  const model = getNextGeminiModelListing();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
    if (res.status === 429) {
      recordRateLimit("gemini_market");
      recordRateLimit("gemini_model");
    }
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

/** Strip Open WebUI reasoning block so we get only the final reply text. */
function stripOpenWebUiReasoning(content: string): string {
  const withoutDetails = content.replace(
    /<details[^>]*type="reasoning"[^>]*>[\s\S]*?<\/details>/gi,
    ""
  );
  return withoutDetails.replace(/<[^>]+>/g, "").trim();
}

/** Extract assistant text from Open WebUI / OpenAI-style completion response. */
function extractAssistantContent(body: Record<string, unknown>): string | null {
  const choices = body.choices as Array<{ message?: { content?: string } }> | undefined;
  if (Array.isArray(choices) && choices[0]?.message?.content) {
    return choices[0].message.content;
  }
  const messages = body.messages as Array<{ role?: string; content?: string }> | undefined;
  if (Array.isArray(messages)) {
    const assistant = messages.filter((m) => m.role === "assistant").pop();
    if (assistant?.content) return assistant.content;
  }
  if (typeof body.content === "string") return body.content;
  return null;
}

/** Open WebUI (OpenUI) chat completions: OpenAI-compatible /api/chat/completions, non-stream. */
async function callOpenWebUI(count: number): Promise<AgentMarketSuggestion[]> {
  const baseUrl = config.openWebUiBaseUrl;
  const apiKey = config.openWebUiApiKey;
  if (!baseUrl) return [];

  const url = `${baseUrl}/api/chat/completions`;
  const body = {
    stream: false,
    model: config.openWebUiModel,
    messages: [
      {
        role: "user" as const,
        content: buildSystemPrompt() + "\n\n" + buildUserPrompt(count),
      },
    ],
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Open WebUI API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if ((data as { status?: boolean }).status === true && (data as { task_id?: string }).task_id) {
    return [];
  }

  const rawContent = extractAssistantContent(data);
  if (!rawContent?.trim()) return [];

  const text = stripOpenWebUiReasoning(rawContent);
  return parseSuggestionsFromText(text);
}

/** Grok (XAI) chat completions: https://api.x.ai/v1/chat/completions */
async function callGrok(count: number): Promise<AgentMarketSuggestion[]> {
  const apiKey = getNextGrokKey() ?? config.grokApiKey;
  if (!apiKey?.trim()) {
    return [];
  }

  const model = getNextGrokModel();
  const url = "https://api.x.ai/v1/chat/completions";
  const body = {
    model,
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
    if (res.status === 429) {
      recordRateLimit("grok_key");
      recordRateLimit("grok_model");
    }
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
    amountUsdc: config.agentMarketAmountUsdc,
  };
}

/**
 * Generates agent market payloads from Gemini, Grok, and Open WebUI (when configured).
 * Count is per-source: e.g. count=5 with Gemini + XAI + Open WebUI => 5+5+5 = 15 total markets.
 * Total is capped by agentMarketsPerJob.
 */
export async function generateAgentMarkets(
  count: number
): Promise<CreCreateMarketPayload[]> {
  if (count < 1) return [];

  const useOpenWebUi = Boolean(config.openWebUiBaseUrl);
  const parts = useOpenWebUi ? 3 : 2;
  const maxTotal = config.agentMarketsPerJob;
  const perSourceCount = Math.max(
    1,
    Math.min(count, Math.floor(maxTotal / parts))
  );
  const geminiCount = perSourceCount;
  const grokCount = perSourceCount;
  const openWebUiCount = useOpenWebUi ? perSourceCount : 0;

  const safeCallGemini = (): Promise<AgentMarketSuggestion[]> =>
    callGemini(geminiCount).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) {
        recordRateLimit("gemini_market");
        recordRateLimit("gemini_model");
      }
      return [];
    });
  const safeCallGrok = (): Promise<AgentMarketSuggestion[]> =>
    callGrok(grokCount).catch(() => []);
  const safeCallOpenWebUI = (): Promise<AgentMarketSuggestion[]> =>
    callOpenWebUI(openWebUiCount).catch(() => []);

  const tasks: Promise<AgentMarketSuggestion[]>[] = [
    safeCallGemini(),
    safeCallGrok(),
  ];
  if (openWebUiCount > 0) {
    tasks.push(safeCallOpenWebUI());
  }

  const [geminiSuggestions, grokSuggestions, openWebUiSuggestions = []] =
    await Promise.all(tasks);

  const geminiFiltered = filterSuggestions(geminiSuggestions).slice(
    0,
    geminiCount
  );
  const grokFiltered = filterSuggestions(grokSuggestions).slice(0, grokCount);
  const openWebUiFiltered = filterSuggestions(openWebUiSuggestions).slice(
    0,
    openWebUiCount
  );

  const out: CreCreateMarketPayload[] = [
    ...geminiFiltered.map((s) => toCrePayload(s, "gemini")),
    ...grokFiltered.map((s) => toCrePayload(s, "grok")),
    ...openWebUiFiltered.map((s) => toCrePayload(s, "openwebui")),
  ];

  return out.slice(0, maxTotal);
}
