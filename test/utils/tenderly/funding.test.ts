/**
 * Tests for Tenderly simulate funding: eligibility and constants.
 * Does not call real Admin RPC; fundSimulateWallet is tested via mocked fetch in integration if needed.
 */

import { describe, it, expect } from "vitest";
import {
  checkFundingEligibility,
  REQUEST_COOLDOWN_MS,
  ETH_FUND_AMOUNT_WEI,
  USDC_FUND_AMOUNT_UNITS,
} from "../../../src/utils/tenderly/funding.js";

const OWNER_ID = "owner-1";
const AGENT_ID = "agent-1";

describe("tenderly funding", () => {
  describe("constants", () => {
    it("REQUEST_COOLDOWN_MS is 7 days in ms", () => {
      expect(REQUEST_COOLDOWN_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("ETH_FUND_AMOUNT_WEI equals 0.1 ETH", () => {
      expect(ETH_FUND_AMOUNT_WEI).toBe(BigInt("100000000000000000"));
    });

    it("USDC_FUND_AMOUNT_UNITS equals 20_000 USDC (6 decimals)", () => {
      expect(USDC_FUND_AMOUNT_UNITS).toBe(BigInt(20_000 * 1_000_000));
    });
  });

  describe("checkFundingEligibility", () => {
    it("returns eligible and firstTime true when lastRequestAt is not provided", () => {
      const result = checkFundingEligibility(OWNER_ID, AGENT_ID);
      expect(result.eligible).toBe(true);
      expect(result.firstTime).toBe(true);
      expect(result.nextRequestAt).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it("returns eligible and firstTime true when lastRequestAt is null", () => {
      const result = checkFundingEligibility(OWNER_ID, AGENT_ID, null);
      expect(result.eligible).toBe(true);
      expect(result.firstTime).toBe(true);
    });

    it("returns eligible and firstTime false when last request was more than cooldown ago", () => {
      const lastRequestAt = Date.now() - REQUEST_COOLDOWN_MS - 60_000;
      const result = checkFundingEligibility(OWNER_ID, AGENT_ID, lastRequestAt);
      expect(result.eligible).toBe(true);
      expect(result.firstTime).toBe(false);
    });

    it("returns not eligible when within cooldown and sets nextRequestAt and reason", () => {
      const lastRequestAt = Date.now() - 1000;
      const result = checkFundingEligibility(OWNER_ID, AGENT_ID, lastRequestAt);
      expect(result.eligible).toBe(false);
      expect(result.firstTime).toBe(false);
      expect(result.nextRequestAt).toBe(lastRequestAt + REQUEST_COOLDOWN_MS);
      expect(result.reason).toContain("once per week");
    });
  });
});
