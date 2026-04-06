import Decimal from "decimal.js";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import type { Order } from "#/types/market.ts";
import { MatchingEngine } from "../MatchingEngine.ts";

function makeOrder(
	overrides: Partial<Order> & Pick<Order, "side" | "symbol">,
): Order {
	return {
		id: nanoid(),
		type: "limit",
		price: new Decimal(100),
		qty: 10,
		filledQty: 0,
		status: "pending",
		agentId: "test-agent",
		createdAtTick: 1,
		...overrides,
	};
}

describe("MatchingEngine", () => {
	it("initializes books for multiple symbols", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL", "MSFT"]);

		expect(engine.getBook("AAPL")).toBeDefined();
		expect(engine.getBook("MSFT")).toBeDefined();
		expect(engine.getBook("GOOGL")).toBeUndefined();
	});

	it("routes orders to the correct book", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL", "MSFT"]);

		engine.processOrder(
			makeOrder({
				side: "sell",
				symbol: "AAPL",
				price: new Decimal(150),
			}),
			1,
		);
		engine.processOrder(
			makeOrder({
				side: "sell",
				symbol: "MSFT",
				price: new Decimal(300),
			}),
			1,
		);

		const aaplSnap = engine.getSnapshot("AAPL");
		expect(aaplSnap.asks).toHaveLength(1);
		expect(aaplSnap.asks[0].price.eq(150)).toBe(true);

		const msftSnap = engine.getSnapshot("MSFT");
		expect(msftSnap.asks).toHaveLength(1);
		expect(msftSnap.asks[0].price.eq(300)).toBe(true);
	});

	it("returns empty trades for unknown symbol and does not throw", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);

		const order = makeOrder({ side: "buy", symbol: "GOOGL" });
		const trades = engine.processOrder(order, 1);

		expect(trades).toEqual([]);
		expect(order.status).toBe("cancelled");
	});

	it("batch processOrders accumulates trades", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);

		// Seed an ask
		engine.processOrder(
			makeOrder({
				side: "sell",
				symbol: "AAPL",
				price: new Decimal(100),
				qty: 20,
			}),
			1,
		);

		// Batch: two market buys
		const trades = engine.processOrders(
			[
				makeOrder({
					side: "buy",
					symbol: "AAPL",
					type: "market",
					price: new Decimal(0),
					qty: 5,
				}),
				makeOrder({
					side: "buy",
					symbol: "AAPL",
					type: "market",
					price: new Decimal(0),
					qty: 8,
				}),
			],
			2,
		);

		expect(trades).toHaveLength(2);
		expect(trades[0].qty).toBe(5);
		expect(trades[1].qty).toBe(8);
	});

	it("emits buyer and seller agent IDs on trades", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);

		engine.processOrder(
			makeOrder({
				side: "sell",
				symbol: "AAPL",
				price: new Decimal(100),
				qty: 10,
				agentId: "seller-1",
			}),
			1,
		);

		const trades = engine.processOrder(
			makeOrder({
				side: "buy",
				symbol: "AAPL",
				type: "market",
				price: new Decimal(0),
				qty: 4,
				agentId: "buyer-1",
			}),
			2,
		);

		expect(trades).toHaveLength(1);
		expect(trades[0].buyerAgentId).toBe("buyer-1");
		expect(trades[0].sellerAgentId).toBe("seller-1");
	});

	it("seedBook creates expected depth on both sides", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);

		engine.seedBook("AAPL", new Decimal(150), new Decimal("0.10"), 5, 100, 0);

		const snap = engine.getSnapshot("AAPL");
		expect(snap.bids).toHaveLength(5);
		expect(snap.asks).toHaveLength(5);

		// Best bid should be midPrice - halfSpread = 149.95
		expect(snap.bids[0].price.eq("149.95")).toBe(true);
		// Best ask should be midPrice + halfSpread = 150.05
		expect(snap.asks[0].price.eq("150.05")).toBe(true);

		// Each level should have 100 qty
		expect(snap.bids[0].qty).toBe(100);
		expect(snap.asks[0].qty).toBe(100);
	});

	it("cancelOrder removes order from the correct book", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);

		const order = makeOrder({
			side: "buy",
			symbol: "AAPL",
			price: new Decimal(100),
		});
		engine.processOrder(order, 1);

		const cancelled = engine.cancelOrder(order.id, "AAPL");
		expect(cancelled).not.toBeNull();
		expect(cancelled!.status).toBe("cancelled");

		expect(engine.getSnapshot("AAPL").bids).toHaveLength(0);
	});

	it("cancelOrder returns null for unknown symbol", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);

		expect(engine.cancelOrder("fake-id", "GOOGL")).toBeNull();
	});

	it("getSnapshot returns correct structure", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);

		const snap = engine.getSnapshot("AAPL");
		expect(snap.symbol).toBe("AAPL");
		expect(snap.bids).toEqual([]);
		expect(snap.asks).toEqual([]);
		expect(snap.lastPrice).toBeNull();
		expect(snap.spread).toBeNull();
	});

	it("symbols are independent — trades in one don't affect another", () => {
		const engine = new MatchingEngine();
		engine.initialize(["AAPL", "MSFT"]);

		engine.seedBook("AAPL", new Decimal(150), new Decimal("0.10"), 3, 50, 0);
		engine.seedBook("MSFT", new Decimal(300), new Decimal("0.20"), 3, 50, 0);

		// Buy all AAPL asks
		const trades = engine.processOrder(
			makeOrder({
				side: "buy",
				symbol: "AAPL",
				type: "market",
				price: new Decimal(0),
				qty: 150,
			}),
			1,
		);

		expect(trades.length).toBeGreaterThan(0);
		// MSFT should be untouched
		expect(engine.getSnapshot("MSFT").asks).toHaveLength(3);
	});
});
