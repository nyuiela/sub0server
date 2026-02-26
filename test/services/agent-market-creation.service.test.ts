/**
 * Tests for agent market creation logic (Gemini + Grok, agentSource).
 * Mocks fetch; does not run CRE workflow.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const CURRENT_YEAR = new Date().getFullYear();
const MOCK_ORACLE = "0x111111111111111111111111111111111111111111";
const MOCK_CREATOR = "0x222222222222222222222222222222222222222222";

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("PLATFORM_ORACLE_ADDRESS", MOCK_ORACLE);
  vi.stubEnv("PLATFORM_CREATOR_ADDRESS", MOCK_CREATOR);
  vi.stubEnv("AGENT_MARKETS_PER_JOB", "10");
  vi.stubEnv("GEMINI_MODEL", "gemini-2.0-flash");
  vi.stubEnv("GROK_API_KEY", "");
});

describe("agent-market-creation.service", () => {
  describe("generateAgentMarkets", () => {
    it("returns CRE payloads with required fields and agentSource when Gemini returns valid array", async () => {
      const mockPayload = [
        {
          question: `Will the first human land on Mars by ${CURRENT_YEAR}?`,
          durationSeconds: 86400,
          outcomeSlotCount: 2,
        },
        {
          question: `Will BTC exceed $100k by end of ${CURRENT_YEAR}?`,
        },
      ];

      const mockFetch = (url: string) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                candidates: [
                  {
                    content: {
                      parts: [{ text: JSON.stringify(mockPayload) }],
                    },
                  },
                ],
              }),
          });
        }
        if (url.includes("api.x.ai")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [{ message: { content: "[]" } }],
              }),
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      };
      vi.stubGlobal("fetch", vi.fn(mockFetch));

      const { generateAgentMarkets } = await import(
        "../../src/services/agent-market-creation.service.js"
      );
      const result = await generateAgentMarkets(5);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(5);

      for (const p of result) {
        expect(p).toHaveProperty("action", "createMarket");
        expect(p).toHaveProperty("question");
        expect(typeof p.question).toBe("string");
        expect(p.question.length).toBeGreaterThan(0);
        expect(p).toHaveProperty("oracle", MOCK_ORACLE);
        expect(p).toHaveProperty("creatorAddress", MOCK_CREATOR);
        expect(p).toHaveProperty("duration");
        expect(typeof p.duration).toBe("number");
        expect(p.duration).toBeGreaterThan(0);
        expect(p).toHaveProperty("outcomeSlotCount");
        expect(p.outcomeSlotCount).toBeGreaterThanOrEqual(2);
        expect(p).toHaveProperty("oracleType", 1);
        expect(p).toHaveProperty("marketType", 2);
        expect(["gemini", "grok"]).toContain(p.agentSource);
      }

      const first = result[0];
      expect(first.question).toContain(String(CURRENT_YEAR));
    });

    it("tags payloads with agentSource gemini and grok when both APIs return data", async () => {
      const geminiPayload = [
        { question: `Gemini question ${CURRENT_YEAR}?`, durationSeconds: 86400 },
      ];
      const grokPayload = [
        { question: `Grok question ${CURRENT_YEAR}?`, durationSeconds: 86400 },
      ];

      let callCount = 0;
      const mockFetch = (url: string) => {
        callCount++;
        if (url.includes("generativelanguage.googleapis.com")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                candidates: [
                  {
                    content: {
                      parts: [{ text: JSON.stringify(geminiPayload) }],
                    },
                  },
                ],
              }),
          });
        }
        if (url.includes("api.x.ai")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [
                  {
                    message: {
                      content: JSON.stringify(grokPayload),
                    },
                  },
                ],
              }),
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      };
      vi.stubGlobal("fetch", vi.fn(mockFetch));

      vi.stubEnv("GROK_API_KEY", "grok-key");
      const { generateAgentMarkets } = await import(
        "../../src/services/agent-market-creation.service.js"
      );
      const result = await generateAgentMarkets(4);

      expect(callCount).toBe(2);
      const sources = result.map((p) => p.agentSource);
      expect(sources).toContain("gemini");
      expect(sources).toContain("grok");
    });

    it("filters out suggestions with past years only", async () => {
      const mockPayload = [
        { question: "Will X happen in 2020?", durationSeconds: 86400 },
        {
          question: `Will Y happen in ${CURRENT_YEAR}?`,
          durationSeconds: 86400,
        },
      ];

      const mockFetch = (url: string) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                candidates: [
                  {
                    content: {
                      parts: [{ text: JSON.stringify(mockPayload) }],
                    },
                  },
                ],
              }),
          });
        }
        if (url.includes("api.x.ai")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [{ message: { content: "[]" } }],
              }),
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      };
      vi.stubGlobal("fetch", vi.fn(mockFetch));

      const { generateAgentMarkets } = await import(
        "../../src/services/agent-market-creation.service.js"
      );
      const result = await generateAgentMarkets(5);

      const questions = result.map((p) => p.question);
      expect(
        questions.some(
          (q) => q.includes("2020") && !q.includes(String(CURRENT_YEAR))
        )
      ).toBe(false);
      expect(questions.some((q) => q.includes(String(CURRENT_YEAR)))).toBe(
        true
      );
    });

    it("throws when GEMINI_API_KEY is unset", async () => {
      vi.stubEnv("GEMINI_API_KEY", "");
      const { generateAgentMarkets } = await import(
        "../../src/services/agent-market-creation.service.js"
      );
      await expect(generateAgentMarkets(2)).rejects.toThrow(
        /GEMINI_API_KEY is not set/
      );
    });

    it("respects count cap", async () => {
      const many = Array.from({ length: 15 }, (_, i) => ({
        question: `Will event ${i} happen by ${CURRENT_YEAR}?`,
        durationSeconds: 86400,
      }));

      const mockFetch = (url: string) => {
        if (url.includes("generativelanguage.googleapis.com")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                candidates: [
                  {
                    content: {
                      parts: [{ text: JSON.stringify(many) }],
                    },
                  },
                ],
              }),
          });
        }
        if (url.includes("api.x.ai")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                choices: [{ message: { content: "[]" } }],
              }),
          });
        }
        return Promise.reject(new Error("Unknown URL"));
      };
      vi.stubGlobal("fetch", vi.fn(mockFetch));

      vi.stubEnv("AGENT_MARKETS_PER_JOB", "5");
      const { generateAgentMarkets } = await import(
        "../../src/services/agent-market-creation.service.js"
      );
      const result = await generateAgentMarkets(10);
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });
});
