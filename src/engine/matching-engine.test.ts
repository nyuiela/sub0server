import { describe, it, expect, beforeEach } from "vitest";
import { OrderBook } from "./matching-engine.js";

const MARKET = "market-1";

function orderId(): string {
  return `order-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

describe("OrderBook", () => {
  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook(MARKET);
  });

  describe("validation", () => {
    it("rejects zero quantity", () => {
      const result = book.processOrder({
        id: orderId(),
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 0,
      });
      expect(result.order.status).toBe("REJECTED");
      expect(result.trades).toHaveLength(0);
      expect(result.orderBookSnapshot.bids).toHaveLength(0);
    });

    it("rejects negative quantity", () => {
      const result = book.processOrder({
        id: orderId(),
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: -5,
      });
      expect(result.order.status).toBe("REJECTED");
      expect(result.trades).toHaveLength(0);
    });

    it("rejects LIMIT order with zero price", () => {
      const result = book.processOrder({
        id: orderId(),
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 0,
        quantity: 10,
      });
      expect(result.order.status).toBe("REJECTED");
      expect(result.trades).toHaveLength(0);
    });
  });

  describe("LIMIT order resting", () => {
    it("adds LIMIT bid to book when no matching ask", () => {
      const result = book.processOrder({
        id: orderId(),
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 10,
      });
      expect(result.order.status).toBe("LIVE");
      expect(result.trades).toHaveLength(0);
      expect(result.orderBookSnapshot.bids).toHaveLength(1);
      expect(result.orderBookSnapshot.bids[0].price).toBe("100.000000000000000000");
      expect(result.orderBookSnapshot.bids[0].quantity).toBe("10.000000000000000000");
      expect(result.orderBookSnapshot.asks).toHaveLength(0);
    });

    it("adds LIMIT ask to book when no matching bid", () => {
      const result = book.processOrder({
        id: orderId(),
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 101,
        quantity: 5,
      });
      expect(result.order.status).toBe("LIVE");
      expect(result.trades).toHaveLength(0);
      expect(result.orderBookSnapshot.asks).toHaveLength(1);
      expect(result.orderBookSnapshot.asks[0].quantity).toBe("5.000000000000000000");
    });
  });

  describe("LIMIT order matching", () => {
    it("fully fills taker and partially fills maker", () => {
      book.processOrder({
        id: "ask-1",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: 10,
      });
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 5,
      });
      expect(result.order.status).toBe("FILLED");
      expect(result.order.remainingQty).toBe("0.000000000000000000");
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].price).toBe("100.000000000000000000");
      expect(result.trades[0].quantity).toBe("5.000000000000000000");
      expect(result.trades[0].makerOrderId).toBe("ask-1");
      expect(result.trades[0].takerOrderId).toBe("bid-1");
      expect(result.orderBookSnapshot.asks).toHaveLength(1);
      expect(result.orderBookSnapshot.asks[0].quantity).toBe("5.000000000000000000");
    });

    it("fully fills both sides when quantities match", () => {
      book.processOrder({
        id: "ask-1",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: 10,
      });
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 10,
      });
      expect(result.order.status).toBe("FILLED");
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity).toBe("10.000000000000000000");
      expect(result.orderBookSnapshot.bids).toHaveLength(0);
      expect(result.orderBookSnapshot.asks).toHaveLength(0);
    });

    it("matches at maker price (price-time priority)", () => {
      book.processOrder({
        id: "ask-1",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 99,
        quantity: 10,
      });
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 5,
      });
      expect(result.trades[0].price).toBe("99.000000000000000000");
      expect(result.trades[0].quantity).toBe("5.000000000000000000");
    });

    it("fills best ask first when multiple levels", () => {
      book.processOrder({
        id: "ask-101",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 101,
        quantity: 10,
      });
      book.processOrder({
        id: "ask-100",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: 10,
      });
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 101,
        quantity: 15,
      });
      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].price).toBe("100.000000000000000000");
      expect(result.trades[0].quantity).toBe("10.000000000000000000");
      expect(result.trades[1].price).toBe("101.000000000000000000");
      expect(result.trades[1].quantity).toBe("5.000000000000000000");
      expect(result.order.status).toBe("FILLED");
    });

    it("time priority: same price level FIFO", () => {
      book.processOrder({
        id: "ask-1",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: 5,
      });
      book.processOrder({
        id: "ask-2",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: 5,
      });
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 7,
      });
      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].makerOrderId).toBe("ask-1");
      expect(result.trades[0].quantity).toBe("5.000000000000000000");
      expect(result.trades[1].makerOrderId).toBe("ask-2");
      expect(result.trades[1].quantity).toBe("2.000000000000000000");
    });
  });

  describe("MARKET order", () => {
    it("fills at best price and does not rest", () => {
      book.processOrder({
        id: "ask-1",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: 10,
      });
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "MARKET",
        quantity: 5,
      });
      expect(result.order.status).toBe("FILLED");
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].price).toBe("100.000000000000000000");
      expect(result.trades[0].quantity).toBe("5.000000000000000000");
      expect(result.orderBookSnapshot.asks[0].quantity).toBe("5.000000000000000000");
    });

    it("rejects MARKET order when no liquidity", () => {
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "MARKET",
        quantity: 10,
      });
      expect(result.order.status).toBe("REJECTED");
      expect(result.trades).toHaveLength(0);
    });

    it("partially fills MARKET then rejects remainder", () => {
      book.processOrder({
        id: "ask-1",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: 3,
      });
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "MARKET",
        quantity: 10,
      });
      expect(result.order.status).toBe("CANCELLED");
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity).toBe("3.000000000000000000");
      expect(result.order.remainingQty).toBe("7.000000000000000000");
    });
  });

  describe("IOC order", () => {
    it("fills available and cancels remainder", () => {
      book.processOrder({
        id: "ask-1",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: 5,
      });
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "IOC",
        price: 100,
        quantity: 10,
      });
      expect(result.order.status).toBe("CANCELLED");
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].quantity).toBe("5.000000000000000000");
      expect(result.order.remainingQty).toBe("5.000000000000000000");
      expect(result.orderBookSnapshot.asks).toHaveLength(0);
    });

    it("IOC with no match does not rest", () => {
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "IOC",
        price: 100,
        quantity: 10,
      });
      expect(result.order.status).toBe("CANCELLED");
      expect(result.trades).toHaveLength(0);
      expect(result.orderBookSnapshot.bids).toHaveLength(0);
    });
  });

  describe("snapshot", () => {
    it("returns empty book initially", () => {
      const snap = book.getSnapshot();
      expect(snap.marketId).toBe(MARKET);
      expect(snap.bids).toHaveLength(0);
      expect(snap.asks).toHaveLength(0);
      expect(typeof snap.timestamp).toBe("number");
    });

    it("aggregates quantity at same price level", () => {
      book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 10,
      });
      book.processOrder({
        id: "bid-2",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 20,
      });
      const snap = book.getSnapshot();
      expect(snap.bids).toHaveLength(1);
      expect(snap.bids[0].quantity).toBe("30.000000000000000000");
      expect(snap.bids[0].orderCount).toBe(2);
    });

    it("sorts bids descending and asks ascending", () => {
      book.processOrder({
        id: "bid-lo",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 98,
        quantity: 1,
      });
      book.processOrder({
        id: "bid-hi",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 1,
      });
      book.processOrder({
        id: "ask-hi",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 102,
        quantity: 1,
      });
      book.processOrder({
        id: "ask-lo",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 101,
        quantity: 1,
      });
      const snap = book.getSnapshot();
      expect(snap.bids[0].price).toBe("100.000000000000000000");
      expect(snap.bids[1].price).toBe("98.000000000000000000");
      expect(snap.asks[0].price).toBe("101.000000000000000000");
      expect(snap.asks[1].price).toBe("102.000000000000000000");
    });
  });

  describe("BID does not cross when ask above limit price", () => {
    it("does not match when best ask is above limit price", () => {
      book.processOrder({
        id: "ask-1",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 101,
        quantity: 10,
      });
      const result = book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 100,
        quantity: 10,
      });
      expect(result.trades).toHaveLength(0);
      expect(result.order.status).toBe("LIVE");
      expect(result.orderBookSnapshot.bids).toHaveLength(1);
      expect(result.orderBookSnapshot.asks).toHaveLength(1);
    });
  });

  describe("ASK does not cross when bid below limit price", () => {
    it("does not match when best bid is below limit price", () => {
      book.processOrder({
        id: "bid-1",
        marketId: MARKET,
        side: "BID",
        type: "LIMIT",
        price: 99,
        quantity: 10,
      });
      const result = book.processOrder({
        id: "ask-1",
        marketId: MARKET,
        side: "ASK",
        type: "LIMIT",
        price: 100,
        quantity: 10,
      });
      expect(result.trades).toHaveLength(0);
      expect(result.order.status).toBe("LIVE");
    });
  });
});
