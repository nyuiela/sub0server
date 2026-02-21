import { describe, it, expect } from "vitest";
import {
  calculateCost,
  getInstantPrice,
  calculateTradeCost,
  applyTradeVector,
  getTradeCostFromVector,
  worstCaseLoss,
  getAllPrices,
  getQuoteForBuy,
  getQuoteForSell,
} from "./lmsr-engine.js";

const DEC = 18;

function sumPrices(prices: string[]): string {
  return prices.reduce((a, b) => {
    const x = parseFloat(a) + parseFloat(b);
    return x.toFixed(DEC);
  }, "0");
}

describe("LMSR engine with changing market data", () => {
  describe("binary market: prices sum to 1", () => {
    it("initial state [0, 0] has prices 0.5 each", () => {
      const q: string[] = ["0", "0"];
      const b = "100";
      const prices = getAllPrices(q, b);
      expect(prices).toHaveLength(2);
      expect(parseFloat(prices[0])).toBeCloseTo(0.5, 10);
      expect(parseFloat(prices[1])).toBeCloseTo(0.5, 10);
      expect(parseFloat(sumPrices(prices))).toBeCloseTo(1, 10);
    });

    it("after buying outcome 0, price 0 increases and prices still sum to 1", () => {
      const b = "100";
      let q: string[] = ["0", "0"];
      const prices0 = getAllPrices(q, b);
      expect(parseFloat(sumPrices(prices0))).toBeCloseTo(1, 10);

      const buy10 = getQuoteForBuy(q, b, 0, "10");
      q = buy10.qAfter;
      expect(q[0]).toBe("10.000000000000000000");
      expect(q[1]).toBe("0.000000000000000000");

      const prices1 = getAllPrices(q, b);
      expect(parseFloat(prices1[0])).toBeGreaterThan(0.5);
      expect(parseFloat(prices1[1])).toBeLessThan(0.5);
      expect(parseFloat(sumPrices(prices1))).toBeCloseTo(1, 10);
    });
  });

  describe("multiple markets with different b and initial q", () => {
    const markets: { name: string; q: string[]; b: string }[] = [
      { name: "binary-equal", q: ["0", "0"], b: "50" },
      { name: "binary-skewed", q: ["20", "5"], b: "100" },
      { name: "ternary", q: ["0", "0", "0"], b: "80" },
    ];

    it("cost increases when buying (any outcome) on each market", () => {
      for (const market of markets) {
        let q = [...market.q];
        let costBefore = calculateCost(q, market.b);

        for (let outcome = 0; outcome < q.length; outcome++) {
          const vec = q.map((_, i) => (i === outcome ? "5" : "0"));
          const qAfter = applyTradeVector(q, vec);
          const costAfter = calculateCost(qAfter, market.b);
          expect(parseFloat(costAfter)).toBeGreaterThan(parseFloat(costBefore));
          const tradeCost = calculateTradeCost(q, qAfter, market.b);
          expect(parseFloat(tradeCost)).toBeCloseTo(
            parseFloat(costAfter) - parseFloat(costBefore),
            10
          );
          q = qAfter;
          costBefore = costAfter;
        }
      }
    });

    it("sell decreases cost and trade cost is negative", () => {
      const market = markets[1];
      let q = [...market.q];
      const sellQty = "3";
      const outcome = 0;
      const vec = q.map((_, i) => (i === outcome ? "-" + sellQty : "0"));
      const qAfter = applyTradeVector(q, vec);
      const costBefore = calculateCost(q, market.b);
      const costAfter = calculateCost(qAfter, market.b);
      expect(parseFloat(costAfter)).toBeLessThan(parseFloat(costBefore));
      const tradeCost = calculateTradeCost(q, qAfter, market.b);
      expect(parseFloat(tradeCost)).toBeLessThan(0);
    });
  });

  describe("order sequence: simulate backend order flow", () => {
    it("sequence of buys and sells updates q and cost consistently", () => {
      const b = "100";
      let q: string[] = ["0", "0"];
      let totalCostPaid = 0;
      let totalCostReceived = 0;

      const buy1 = getQuoteForBuy(q, b, 0, "10");
      expect(parseFloat(buy1.tradeCost)).toBeGreaterThan(0);
      totalCostPaid += parseFloat(buy1.tradeCost);
      q = buy1.qAfter;

      const buy2 = getQuoteForBuy(q, b, 1, "5");
      totalCostPaid += parseFloat(buy2.tradeCost);
      q = buy2.qAfter;

      const sell1 = getQuoteForSell(q, b, 0, "3");
      expect(parseFloat(sell1.tradeCost)).toBeLessThan(0);
      totalCostReceived += Math.abs(parseFloat(sell1.tradeCost));
      q = sell1.qAfter;

      const costNow = parseFloat(calculateCost(q, b));
      expect(q[0]).toBe("7.000000000000000000");
      expect(q[1]).toBe("5.000000000000000000");
      expect(costNow).toBeGreaterThan(0);
      expect(totalCostPaid).toBeGreaterThan(totalCostReceived);
    });

    it("getTradeCostFromVector matches calculateTradeCost after applyTradeVector", () => {
      const b = "50";
      const q: string[] = ["10", "20", "5"];
      const tradeVector: string[] = ["2", "-1", "0"];
      const qAfter = applyTradeVector(q, tradeVector);
      const costDirect = calculateTradeCost(q, qAfter, b);
      const costFromVec = getTradeCostFromVector(q, b, tradeVector);
      expect(parseFloat(costDirect)).toBeCloseTo(parseFloat(costFromVec), 12);
    });
  });

  describe("worst-case loss bounded by b*ln(n)", () => {
    it("worstCaseLoss(b, n) = b * ln(n) for several b and n", () => {
      expect(parseFloat(worstCaseLoss("100", 2))).toBeCloseTo(100 * Math.LN2, 8);
      expect(parseFloat(worstCaseLoss("50", 3))).toBeCloseTo(50 * Math.log(3), 8);
      expect(parseFloat(worstCaseLoss("200", 10))).toBeCloseTo(200 * Math.log(10), 8);
    });
  });

  describe("changing data: different initial q and order of operations", () => {
    it("same final q gives same cost regardless of path (path independence)", () => {
      const b = "100";
      const finalQ: string[] = ["8", "12", "5"];

      const path1 = (() => {
        let q: string[] = ["0", "0", "0"];
        q = applyTradeVector(q, ["8", "0", "0"]);
        q = applyTradeVector(q, ["0", "12", "0"]);
        q = applyTradeVector(q, ["0", "0", "5"]);
        return calculateCost(q, b);
      })();

      const path2 = (() => {
        let q: string[] = ["0", "0", "0"];
        q = applyTradeVector(q, ["8", "12", "5"]);
        return calculateCost(q, b);
      })();

      expect(parseFloat(path1)).toBeCloseTo(parseFloat(path2), 10);
      expect(parseFloat(path1)).toBeCloseTo(parseFloat(calculateCost(finalQ, b)), 10);
    });

    it("two markets with same b but different q have different prices and costs", () => {
      const b = "80";
      const marketA = { q: ["0", "0"], b };
      const marketB = { q: ["30", "10"], b };

      const costA = parseFloat(calculateCost(marketA.q, b));
      const costB = parseFloat(calculateCost(marketB.q, b));
      expect(costB).toBeGreaterThan(costA);

      const priceA0 = parseFloat(getInstantPrice(marketA.q, b, 0));
      const priceB0 = parseFloat(getInstantPrice(marketB.q, b, 0));
      expect(priceB0).toBeGreaterThan(priceA0);
    });
  });

  describe("edge cases with changing q", () => {
    it("rejects sell more than outstanding", () => {
      const q: string[] = ["5", "5"];
      const b = "100";
      expect(() => getQuoteForSell(q, b, 0, "10")).toThrow("cannot sell more than outstanding");
    });

    it("rejects negative q from trade vector", () => {
      const q: string[] = ["3", "3"];
      const b = "100";
      const vec: string[] = ["-5", "0"];
      expect(() => getTradeCostFromVector(q, b, vec)).toThrow("resulting quantity cannot be negative");
    });

    it("large b: prices stay closer to uniform after trade", () => {
      const qSmallB: string[] = ["10", "0"];
      const qLargeB: string[] = ["10", "0"];
      const smallB = "10";
      const largeB = "500";

      const p0Small = parseFloat(getInstantPrice(qSmallB, smallB, 0));
      const p0Large = parseFloat(getInstantPrice(qLargeB, largeB, 0));
      expect(p0Small).toBeGreaterThan(p0Large);
    });
  });
});
