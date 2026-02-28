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
import { computeQuestionId } from "../lib/cre-question-id.js";
import { getPrismaClient } from "../lib/prisma.js";
import {
  getMarketGenerationSystemPrompt,
  getMarketGenerationUserPrompt,
} from "../prompts/load-market-prompts.js";
import { withQuestionUniqueSuffix } from "../lib/cre-question-unique-suffix.js";
import type {
  AgentMarketSuggestion,
  CreCreateMarketPayload,
  CreDraftPayloadForCre,
  AgentSource,
} from "../types/agent-markets.js";
import { Hex } from "thirdweb";
import contracts from "../lib/contracts.json" with { type: "json" };

const DEFAULT_DURATION_SECONDS = 86400;
const DEFAULT_OUTCOME_SLOT_COUNT = 2;
const ORACLE_TYPE_PLATFORM = 1;
const MARKET_TYPE_PUBLIC = 1;
const MAX_QUESTION_LENGTH = 256;
const CURRENT_YEAR = new Date().getFullYear();

const MARKET_CATEGORIES = [
  "entertainment",
  "movies",
  "TV and series",
  "music",
  "sports",
  "tech",
  "AI and AI companies",
  "stocks and finance",
  "crypto",
  "politics",
  "social media and influencers",
  "viral and trending topics",
  "news and world events",
  "science",
  "gaming",
  "celebrities",
  "controversial trending topics",
  "trending X topics and conversations",
  "business and startups",
  "culture and awards",
  "space and science",
] as const;

function pickRandomCategories(n: number): string[] {
  const shuffled = [...MARKET_CATEGORIES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

const SYSTEM_PROMPT_VARS = {
  currentYear: CURRENT_YEAR,
  categoryList: MARKET_CATEGORIES.join(", "),
  maxQuestionLength: MAX_QUESTION_LENGTH,
  defaultDurationSeconds: DEFAULT_DURATION_SECONDS,
  defaultOutcomeSlotCount: DEFAULT_OUTCOME_SLOT_COUNT,
};

function buildSystemPrompt(): string {
  return getMarketGenerationSystemPrompt(SYSTEM_PROMPT_VARS);
}

function buildEmphasisInstruction(emphasisCategories: string[] | undefined): string {
  if (emphasisCategories != null && emphasisCategories.length > 0) {
    const list = emphasisCategories.join(", ");
    return `For this batch you MUST include at least one question from each of these categories: ${list}. Spread the rest across other categories. Include at least one question focused on a non-US region (Europe, UK, Asia, Africa, Latin America, or global). For any crypto or price questions use varied price targets and timeframes.`;
  }
  return "Ensure each question is from a different category. Include a mix of US and global (Europe, UK, Asia, Africa, Latin America, world events). For crypto/price questions use varied price levels and dates.";
}

function buildUserPrompt(count: number, emphasisCategories?: string[]): string {
  const emphasisInstruction = buildEmphasisInstruction(emphasisCategories);
  return getMarketGenerationUserPrompt(count, emphasisInstruction);
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
  const emphasis = pickRandomCategories(4);
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildSystemPrompt() + "\n\n" + buildUserPrompt(count, emphasis) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.85,
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

  const emphasis = pickRandomCategories(4);
  const url = `${baseUrl}/api/chat/completions`;
  const body = {
    stream: false,
    model: config.openWebUiModel,
    messages: [
      {
        role: "user" as const,
        content: buildSystemPrompt() + "\n\n" + buildUserPrompt(count, emphasis),
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
  const emphasis = pickRandomCategories(4);
  const body = {
    model,
    messages: [
      {
        role: "user",
        content:
          buildSystemPrompt() +
          "\n\n" +
          buildUserPrompt(count, emphasis),
      },
    ],
    max_tokens: 8192,
    temperature: 0.85,
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
    const raw = item as Record<string, unknown>;
    const ctx = typeof raw.context === "string" ? raw.context.trim().slice(0, 256) : undefined;
    suggestions.push({
      question: q.trim().slice(0, MAX_QUESTION_LENGTH),
      context: ctx && ctx.length > 0 ? ctx : undefined,
      durationSeconds:
        typeof raw.durationSeconds === "number" ? (raw.durationSeconds as number) : undefined,
      outcomeSlotCount:
        typeof raw.outcomeSlotCount === "number" ? (raw.outcomeSlotCount as number) : undefined,
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
    context: suggestion.context,
  };
}

/** Max markets per run sent to CRE; must not exceed CRE batch cap (e.g. 50). */
const MAX_MARKETS_PER_RUN = 50;

/**
 * Generates agent market payloads from Gemini, Grok (XAI), and Open WebUI (when configured).
 * Count is per-agent: e.g. count=4 with 3 agents => 4+4+4 = 12 total markets in one batch to CRE.
 */
export async function generateAgentMarkets(
  count: number
): Promise<CreCreateMarketPayload[]> {
  if (count < 1) return [];

  const useOpenWebUi = Boolean(config.openWebUiBaseUrl);
  const agents = useOpenWebUi ? 3 : 2;
  const perAgentCount = Math.min(
    count,
    Math.max(1, Math.floor(MAX_MARKETS_PER_RUN / agents))
  );
  const geminiCount = perAgentCount;
  const grokCount = perAgentCount;
  const openWebUiCount = useOpenWebUi ? perAgentCount : 0;

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

  return [
    ...geminiFiltered.map((s) => toCrePayload(s, "gemini")),
    ...grokFiltered.map((s) => toCrePayload(s, "grok")),
    ...openWebUiFiltered.map((s) => toCrePayload(s, "openwebui")),
  ];
}

/**
 * Filters out payloads whose questionId already exists in the DB (avoid duplicate CRE create).
 */
export async function filterPayloadsByExistingQuestionId(
  payloads: CreCreateMarketPayload[]
): Promise<CreCreateMarketPayload[]> {
  if (payloads.length === 0) return [];
  const prisma = getPrismaClient();
  const filtered: CreCreateMarketPayload[] = [];
  for (const p of payloads) {
    const qid = computeQuestionId(p.question, p.creatorAddress, p.oracle);
    const existing = await prisma.market.findFirst({
      where: { questionId: qid },
      select: { id: true },
    });
    if (!existing) filtered.push(p);
  }
  return filtered;
}

// const DEFAULT_COLLATERAL =
// "0x0ecdaB3BfcA91222b162A624D893bF49ec16ddBE";

/** DiceBear URL for market image; seed must be alphanumeric. Uses market id for unique image per market. */
function marketImageUrl(seed: string): string {
  const safe = seed.replace(/^0x/, "").replace(/[^a-zA-Z0-9]/g, "a").slice(0, 32) || "default";
  return `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(safe)}`;
}

/**
 * Creates draft markets in the DB from agent suggestions (no conditionId/questionId).
 * Call this to refill the draft pool; then send drafts to CRE via getDraftMarketsForCre.
 */
export async function createDraftMarketsFromAgents(
  count: number
): Promise<{ created: number }> {
  if (count < 1) return { created: 0 };
  const payloads = await generateAgentMarkets(count);
  if (payloads.length === 0) return { created: 0 };
  const prisma = getPrismaClient();
  const collateralToken = contracts.contracts?.usdc as Hex;
  let created = 0;
  for (const p of payloads) {
    const qid = computeQuestionId(p.question, p.creatorAddress, p.oracle);
    const existing = await prisma.market.findFirst({
      where: { questionId: qid },
      select: { id: true },
    });
    if (existing) continue;
    const resolutionDate = new Date(Date.now() + p.duration * 1000);
    const outcomes =
      p.outcomeSlotCount === 2
        ? (["Yes", "No"] as object)
        : (Array.from({ length: p.outcomeSlotCount }, (_, i) => `Outcome ${i + 1}`) as object);
    const market = await prisma.market.create({
      data: {
        name: p.question,
        creatorAddress: p.creatorAddress,
        oracleAddress: p.oracle,
        resolutionDate,
        outcomes,
        collateralToken,
        platform: "NATIVE",
        agentSource: p.agentSource ?? null,
        volume: 0,
        conditionId: null,
        questionId: null,
        context: p.context ?? null,
      },
    });
    await prisma.market.update({
      where: { id: market.id },
      data: { imageUrl: marketImageUrl(market.id) },
    });
    created++;
  }
  return { created };
}

/**
 * Returns draft markets (questionId null) as payloads for CRE.
 * Contract fields + marketId only (no agentSource). CRE echoes marketId in callback for update.
 */
export async function getDraftMarketsForCre(
  limit: number
): Promise<CreDraftPayloadForCre[]> {
  if (limit < 1) return [];
  const prisma = getPrismaClient();
  const drafts = await prisma.market.findMany({
    where: { questionId: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      name: true,
      oracleAddress: true,
      creatorAddress: true,
      resolutionDate: true,
      outcomes: true,
    },
  });
  const now = Date.now();
  return drafts.map((m, index) => {
    const outcomes = m.outcomes as unknown[];
    const outcomeSlotCount = Array.isArray(outcomes) ? outcomes.length : 2;
    const duration = Math.max(
      1,
      Math.floor((m.resolutionDate.getTime() - now) / 1000)
    );
    return {
      marketId: m.id,
      question: withQuestionUniqueSuffix(m.name ?? "", index),
      oracle: m.oracleAddress,
      creatorAddress: m.creatorAddress,
      duration,
      outcomeSlotCount,
      oracleType: ORACLE_TYPE_PLATFORM,
      marketType: MARKET_TYPE_PUBLIC,
      amountUsdc: config.agentMarketAmountUsdc,
    };
  });
}
