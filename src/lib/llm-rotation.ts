/**
 * Round-robin rotation for Gemini and XAI keys/models to spread load and fallback on rate limits.
 * Use getNext*() when starting a request; call recordRateLimit() on 429 to advance to next key/model.
 */

import { config } from "../config/index.js";

type Category = "gemini_trading" | "gemini_market" | "gemini_model" | "grok_key" | "grok_model";

const indices: Record<Category, number> = {
  gemini_trading: 0,
  gemini_market: 0,
  gemini_model: 0,
  grok_key: 0,
  grok_model: 0,
};

function getAndAdvance(category: Category, length: number): number {
  if (length <= 0) return 0;
  const i = indices[category] % length;
  indices[category] += 1;
  return i;
}

export function getNextGeminiKeyTrading(): string | undefined {
  const keys = config.geminiApiKeysTrading;
  return keys[getAndAdvance("gemini_trading", keys.length)];
}

export function getNextGeminiKeyMarketCreation(): string | undefined {
  const keys = config.geminiApiKeysMarketCreation;
  return keys[getAndAdvance("gemini_market", keys.length)];
}

export function getNextGeminiModelListing(): string {
  const models = config.geminiModelsListing;
  return models[getAndAdvance("gemini_model", models.length)] ?? "gemini-2.0-flash";
}

export function getNextGrokKey(): string | undefined {
  const keys = config.grokApiKeys;
  return keys[getAndAdvance("grok_key", keys.length)];
}

export function getNextGrokModel(): string {
  const models = config.grokModels;
  return models[getAndAdvance("grok_model", models.length)] ?? "grok-3-mini";
}

/** Call when a 429 or quota error is received; next getNext* for that category will use the next key/model. */
export function recordRateLimit(category: Category): void {
  indices[category] += 1;
}
