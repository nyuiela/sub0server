/**
 * Two-agent settlement deliberation: each agent gives opinion, reviews the other's, then final verdict.
 * If both final outcome arrays match, consensus; else store reasons.
 * Uses Gemini for both agents (configurable). Outcome array: 1=won, 0=lost per outcome index.
 */

import { config } from "../config/index.js";
import {
  getNextGeminiKeyMarketCreation,
  getNextGeminiModelListing,
  recordRateLimit,
} from "../lib/llm-rotation.js";
import type {
  SettlementVerdict,
  DeliberationResult,
  SettlementRequestPayload,
  OutcomeArray,
} from "../types/settlement.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function buildVerdictPrompt(
  question: string,
  outcomes: string[],
  rules: string | null | undefined,
  phase: "opinion" | "review",
  otherOpinion?: string
): string {
  const outcomeList = outcomes.map((o, i) => `  ${i}: ${o}`).join("\n");
  const rulesBlock = rules?.trim()
    ? `\nRULES (benchmark settlement against these):\n${rules}\n`
    : "";
  if (phase === "opinion") {
    return `You are a prediction market settlement agent. Given the market question and outcomes, give your verdict.

QUESTION: ${question}

OUTCOMES (index is used for outcome array):
${outcomeList}
${rulesBlock}

Respond with JSON only, no markdown:
{
  "outcomeString": "short answer e.g. Yes or No",
  "outcomeArray": [1, 0],
  "reason": "one sentence why"
}
- outcomeArray: same length as outcomes; use 1 for winning outcome(s), 0 for losing. [1,0]=first won, [0,1]=second won, [1,1]=both won (split), [0,0]=none won.`;
  }
  return `You are a prediction market settlement agent. You already gave an opinion. Now review the OTHER agent's opinion and give your FINAL verdict (you may change your mind or stay).

QUESTION: ${question}
OUTCOMES: ${outcomes.join(" | ")}

OTHER AGENT'S OPINION:
${otherOpinion ?? "none"}
${rulesBlock}

Respond with JSON only:
{
  "outcomeString": "final short answer",
  "outcomeArray": [1, 0],
  "reason": "one sentence; if you disagree with the other agent, explain why"
}`;
}

async function callGeminiForVerdict(
  prompt: string,
  model: string
): Promise<{ outcomeString: string; outcomeArray: OutcomeArray; reason?: string }> {
  const apiKey = getNextGeminiKeyMarketCreation() ?? config.geminiApiKey;
  if (!apiKey?.trim()) {
    throw new Error(
      "GEMINI_API_KEY_MARKET_CREATION_1/2/3 or GEMINI_API_KEYS_MARKET_CREATION or GEMINI_API_KEY is not set for settlement deliberation"
    );
  }
  const url = `${GEMINI_URL}/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    if (res.status === 429) {
      recordRateLimit("gemini_market");
      recordRateLimit("gemini_model");
    }
    const text = await res.text();
    throw new Error(`Gemini settlement error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Gemini settlement: empty response");
  const parsed = JSON.parse(text) as {
    outcomeString?: string;
    outcomeArray?: number[];
    reason?: string;
  };
  const arr = parsed.outcomeArray;
  if (!Array.isArray(arr) || arr.some((n) => n !== 0 && n !== 1)) {
    throw new Error("Invalid outcomeArray: must be array of 0 or 1");
  }
  return {
    outcomeString: String(parsed.outcomeString ?? ""),
    outcomeArray: arr,
    reason: parsed.reason != null ? String(parsed.reason) : undefined,
  };
}

function outcomeArraysEqual(a: OutcomeArray, b: OutcomeArray): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Run two-agent deliberation: opinion A, opinion B, then review each other and final verdicts.
 * Returns consensus and outcome array when both agree; otherwise stores reasons in result.
 */
export async function runTwoAgentDeliberation(
  payload: SettlementRequestPayload
): Promise<DeliberationResult> {
  const { question, outcomes, rules } = payload;
  const model = getNextGeminiModelListing();

  const promptA = buildVerdictPrompt(question, outcomes, rules, "opinion");
  const promptB = buildVerdictPrompt(question, outcomes, rules, "opinion");

  const [opinionA, opinionB] = await Promise.all([
    callGeminiForVerdict(promptA, model),
    callGeminiForVerdict(promptB, model),
  ]);

  const reviewPromptA = buildVerdictPrompt(
    question,
    outcomes,
    rules,
    "review",
    `outcomeString: ${opinionB.outcomeString}, outcomeArray: [${opinionB.outcomeArray.join(",")}], reason: ${opinionB.reason ?? ""}`
  );
  const reviewPromptB = buildVerdictPrompt(
    question,
    outcomes,
    rules,
    "review",
    `outcomeString: ${opinionA.outcomeString}, outcomeArray: [${opinionA.outcomeArray.join(",")}], reason: ${opinionA.reason ?? ""}`
  );

  const [finalA, finalB] = await Promise.all([
    callGeminiForVerdict(reviewPromptA, model),
    callGeminiForVerdict(reviewPromptB, model),
  ]);

  const consensus = outcomeArraysEqual(finalA.outcomeArray, finalB.outcomeArray);
  const result: DeliberationResult = {
    consensus,
    outcomeArray: consensus ? finalA.outcomeArray : undefined,
    agentA: {
      outcomeString: finalA.outcomeString,
      outcomeArray: finalA.outcomeArray,
      reason: finalA.reason,
    },
    agentB: {
      outcomeString: finalB.outcomeString,
      outcomeArray: finalB.outcomeArray,
      reason: finalB.reason,
    },
  };
  if (!consensus) {
    result.disputeReasons = {
      agentA: finalA.reason ?? "",
      agentB: finalB.reason ?? "",
    };
  }
  return result;
}
