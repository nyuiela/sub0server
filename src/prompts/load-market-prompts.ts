/**
 * Loads market-generation prompt templates from src/prompts and substitutes placeholders.
 * Edit the .txt files in this directory to change prompts without touching service code.
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = __dirname;

const SYSTEM_FILE = join(PROMPTS_DIR, "market-generation.system.txt");
const USER_FILE = join(PROMPTS_DIR, "market-generation.user.txt");

export interface MarketSystemPromptVars {
  currentYear: number;
  categoryList: string;
  maxQuestionLength: number;
  defaultDurationSeconds: number;
  defaultOutcomeSlotCount: number;
}

function substituteSystem(template: string, vars: MarketSystemPromptVars): string {
  return template
    .replace(/\{\{CURRENT_YEAR\}\}/g, String(vars.currentYear))
    .replace(/\{\{CATEGORY_LIST\}\}/g, vars.categoryList)
    .replace(/\{\{MAX_QUESTION_LENGTH\}\}/g, String(vars.maxQuestionLength))
    .replace(/\{\{DEFAULT_DURATION_SECONDS\}\}/g, String(vars.defaultDurationSeconds))
    .replace(/\{\{DEFAULT_OUTCOME_SLOT_COUNT\}\}/g, String(vars.defaultOutcomeSlotCount));
}

function substituteUser(template: string, count: number, emphasisInstruction: string): string {
  return template
    .replace(/\{\{COUNT\}\}/g, String(count))
    .replace(/\{\{EMPHASIS_INSTRUCTION\}\}/g, emphasisInstruction);
}

function readOptionalFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8").trim();
}

/**
 * Returns the system prompt for market generation. Uses the .txt file if present.
 */
export function getMarketGenerationSystemPrompt(vars: MarketSystemPromptVars): string {
  const template = readOptionalFile(SYSTEM_FILE);
  if (template) return substituteSystem(template, vars);
  return substituteSystem(getBuiltInSystemTemplate(), vars);
}

/**
 * Returns the user prompt for market generation. Uses the .txt file if present.
 */
export function getMarketGenerationUserPrompt(
  count: number,
  emphasisInstruction: string
): string {
  const template = readOptionalFile(USER_FILE);
  const text = template ?? "Generate exactly {{COUNT}} prediction market questions. {{EMPHASIS_INSTRUCTION}} Return only the JSON array.";
  return substituteUser(text, count, emphasisInstruction);
}

function getBuiltInSystemTemplate(): string {
  return `You are a prediction market question generator. Your task is to output a JSON array of market questions.

VARIETY (IMPORTANT):
- Each question in your response MUST be from a DIFFERENT category. Do not generate multiple questions about the same topic area.
- Spread questions across many categories. Use a mix of: {{CATEGORY_LIST}}.
- Avoid repeating the same type of market (e.g. do not output several sports or several tech questions in one response). Vary widely.

GLOBAL SCOPE (IMPORTANT):
- Do NOT limit to the US only. Include markets from ALL regions: Europe, UK, Asia, Africa, Latin America, Middle East, Oceania, and global events.
- Vary geography: EU regulations, UK elections, Asian markets or politics, African sports or events, Latin American news, international summits, global sports (FIFA, Olympics, cricket, etc.), world health, climate, or economy.
- Mix US and non-US so the set feels global, not US-centric.

CRYPTO AND PRICE MARKETS (e.g. Bitcoin, stocks):
- When creating price-level questions (e.g. "Will Bitcoin exceed $X"), be DYNAMIC with the target. Vary the price (e.g. $92,000, $118,000, $165,000, $205,000) instead of always using the same round number like $100,000 or $150,000.
- Vary timeframes and wording: "exceed $X by end of {{CURRENT_YEAR}}", "trade above $X at least once", "close above $X", different months or quarters.
- This reduces duplicate-looking markets even when you cannot remember past questions.

STRICT RULES:
- Use ONLY the current year ({{CURRENT_YEAR}}) in any date or time reference. Do not use past years.
- Questions must be about events that are likely to occur or be verifiable in the future (e.g. "{{CURRENT_YEAR}} elections", "Will X happen by end of {{CURRENT_YEAR}}?").
- Each question must be a single, clear yes/no or multi-outcome prediction.
- No historical or already-resolved events.
- No offensive or harmful content.

OUTPUT FORMAT:
- You MUST respond with a SINGLE JSON array. Each element is an object with:
  - "question": string (required). Clear prediction question. Max {{MAX_QUESTION_LENGTH}} chars.
  - "context": string (optional). One short sentence describing the market topic or resolution criteria. Max 256 chars.
  - "durationSeconds": number (optional). Seconds until resolution. Default {{DEFAULT_DURATION_SECONDS}}.
  - "outcomeSlotCount": number (optional). 2 for binary. Default {{DEFAULT_OUTCOME_SLOT_COUNT}}.
- Output MUST be valid JSON only. No markdown, no code fences, no prose before or after.
- Minified (one line) preferred. Property order: "question" first, then "context", then "durationSeconds", then "outcomeSlotCount".
- Generate exactly the number of items requested (or up to 10 if not specified).`;
}
