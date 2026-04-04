import Decimal from "decimal.js";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import type { Order } from "#/types/market.ts";
import { LimitOrderBook } from "../LimitOrderBook.ts";

function makeOrder(overrides: Partial<Order> & Pick<Order, "side">): Order {
	return {
		id: nanoid(),
		symbol: "AAPL",
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

describe("LimitOrderBook", () => {
	it("rests a limit buy order in the book when no asks exist", () => {
		const book = new LimitOrderBook("AAPL");
		const order = makeOrder({ side: "buy", price: new Decimal(100) });

		const trades = book.addOrder(order, 1);

		expect(trades).toHaveLength(0);
		expect(order.status).toBe("open");
		const snap = book.getSnapshot();
		expect(snap.bids).toHaveLength(1);
		expect(snap.bids[0].price.eq(100)).toBe(true);
		expect(snap.bids[0].qty).toBe(10);
		expect(snap.asks).toHaveLength(0);
	});

	it("rests a limit sell order in the book when no bids exist", () => {
		const book = new LimitOrderBook("AAPL");
		const order = makeOrder({ side: "sell", price: new Decimal(105) });

		const trades = book.addOrder(order, 1);

		expect(trades).toHaveLength(0);
		expect(order.status).toBe("open");
		const snap = book.getSnapshot();
		expect(snap.asks).toHaveLength(1);
		expect(snap.asks[0].price.eq(105)).toBe(true);
	});

	it("market buy hits resting asks", () => {
		const book = new LimitOrderBook("AAPL");

		// Seed resting ask
		const ask = makeOrder({
			side: "sell",
			price: new Decimal(100),
			qty: 10,
		});
		book.addOrder(ask, 1);

		// Market buy
		const buy = makeOrder({
			side: "buy",
			type: "market",
			price: new Decimal(0),
			qty: 10,
		});
		const trades = book.addOrder(buy, 2);

		expect(trades).toHaveLength(1);
		expect(trades[0].price.eq(100)).toBe(true);
		expect(trades[0].qty).toBe(10);
		expect(buy.status).toBe("filled");
		expect(ask.status).toBe("filled");
		expect(book.getSnapshot().asks).toHaveLength(0);
	});

	it("limit buy crossing the spread matches immediately", () => {
		const book = new LimitOrderBook("AAPL");

		const ask = makeOrder({
			side: "sell",
			price: new Decimal(100),
			qty: 5,
		});
		book.addOrder(ask, 1);

		// Buy at ask price — should cross
		const buy = makeOrder({
			side: "buy",
			price: new Decimal(100),
			qty: 5,
		});
		const trades = book.addOrder(buy, 2);

		expect(trades).toHaveLength(1);
		expect(trades[0].price.eq(100)).toBe(true);
		expect(buy.status).toBe("filled");
		expect(ask.status).toBe("filled");
	});

	it("handles partial fills across multiple price levels", () => {
		const book = new LimitOrderBook("AAPL");

		// Two ask levels
		const ask1 = makeOrder({
			side: "sell",
			price: new Decimal(100),
			qty: 5,
		});
		const ask2 = makeOrder({
			side: "sell",
			price: new Decimal(101),
			qty: 5,
		});
		book.addOrder(ask1, 1);
		book.addOrder(ask2, 1);

		// Buy 8 — fills 5 at 100, 3 at 101
		const buy = makeOrder({
			side: "buy",
			type: "market",
			price: new Decimal(0),
			qty: 8,
		});
		const trades = book.addOrder(buy, 2);

		expect(trades).toHaveLength(2);
		expect(trades[0].price.eq(100)).toBe(true);
		expect(trades[0].qty).toBe(5);
		expect(trades[1].price.eq(101)).toBe(true);
		expect(trades[1].qty).toBe(3);

		expect(buy.status).toBe("filled");
		expect(ask1.status).toBe("filled");
		expect(ask2.status).toBe("partial");
		expect(ask2.filledQty).toBe(3);

		// Remaining ask at 101 with qty 2
		const snap = book.getSnapshot();
		expect(snap.asks).toHaveLength(1);
		expect(snap.asks[0].qty).toBe(2);
	});

	it("respects price-time priority (FIFO at same price)", () => {
		const book = new LimitOrderBook("AAPL");

		// Two asks at same price — first one should fill first
		const ask1 = makeOrder({
			side: "sell",
			price: new Decimal(100),
			qty: 5,
			agentId: "first",
		});
		const ask2 = makeOrder({
			side: "sell",
			price: new Decimal(100),
			qty: 5,
			agentId: "second",
		});
		book.addOrder(ask1, 1);
		book.addOrder(ask2, 1);

		// Buy 5 — should match ask1 (first in queue)
		const buy = makeOrder({
			side: "buy",
			type: "market",
			price: new Decimal(0),
			qty: 5,
		});
		const trades = book.addOrder(buy, 2);

		expect(trades).toHaveLength(1);
		expect(trades[0].sellOrderId).toBe(ask1.id);
		expect(trades[0].buyerAgentId).toBe(buy.agentId);
		expect(trades[0].sellerAgentId).toBe(ask1.agentId);
		expect(ask1.status).toBe("filled");
		expect(ask2.status).toBe("open"); // untouched, resting in book
	});

	it("cancels an order and removes it from the book", () => {
		const book = new LimitOrderBook("AAPL");

		const order = makeOrder({
			side: "buy",
			price: new Decimal(99),
			qty: 10,
		});
		book.addOrder(order, 1);
		expect(book.getSnapshot().bids).toHaveLength(1);

		const cancelled = book.cancelOrder(order.id);

		expect(cancelled).not.toBeNull();
		expect(cancelled!.status).toBe("cancelled");
		expect(book.getSnapshot().bids).toHaveLength(0);
	});

	it("returns null when cancelling a non-existent order", () => {
		const book = new LimitOrderBook("AAPL");
		expect(book.cancelOrder("non-existent")).toBeNull();
	});

	it("cancels unfilled market order when no liquidity exists", () => {
		const book = new LimitOrderBook("AAPL");

		const buy = makeOrder({
			side: "buy",
			type: "market",
			price: new Decimal(0),
			qty: 10,
		});
		const trades = book.addOrder(buy, 1);

		expect(trades).toHaveLength(0);
		expect(buy.status).toBe("cancelled");
		expect(buy.filledQty).toBe(0);
	});

	it("computes spread and midPrice correctly", () => {
		const book = new LimitOrderBook("AAPL");

		book.addOrder(
			makeOrder({ side: "buy", price: new Decimal("99.50") }),
			1,
		);
		book.addOrder(
			makeOrder({ side: "sell", price: new Decimal("100.50") }),
			1,
		);

		expect(book.getBestBid()!.eq("99.50")).toBe(true);
		expect(book.getBestAsk()!.eq("100.50")).toBe(true);
		expect(book.getSpread()!.eq("1.00")).toBe(true);
		expect(book.getMidPrice()!.eq("100")).toBe(true);
	});

	it("returns null for spread/midPrice on empty book", () => {
		const book = new LimitOrderBook("AAPL");
		expect(book.getBestBid()).toBeNull();
		expect(book.getBestAsk()).toBeNull();
		expect(book.getSpread()).toBeNull();
		expect(book.getMidPrice()).toBeNull();
	});

	it("maintains correct bid ordering (descending)", () => {
		const book = new LimitOrderBook("AAPL");

		book.addOrder(
			makeOrder({ side: "buy", price: new Decimal(98) }),
			1,
		);
		book.addOrder(
			makeOrder({ side: "buy", price: new Decimal(100) }),
			1,
		);
		book.addOrder(
			makeOrder({ side: "buy", price: new Decimal(99) }),
			1,
		);

		const snap = book.getSnapshot();
		expect(snap.bids[0].price.eq(100)).toBe(true);
		expect(snap.bids[1].price.eq(99)).toBe(true);
		expect(snap.bids[2].price.eq(98)).toBe(true);
	});

	it("maintains correct ask ordering (ascending)", () => {
		const book = new LimitOrderBook("AAPL");

		book.addOrder(
			makeOrder({ side: "sell", price: new Decimal(103) }),
			1,
		);
		book.addOrder(
			makeOrder({ side: "sell", price: new Decimal(101) }),
			1,
		);
		book.addOrder(
			makeOrder({ side: "sell", price: new Decimal(102) }),
			1,
		);

		const snap = book.getSnapshot();
		expect(snap.asks[0].price.eq(101)).toBe(true);
		expect(snap.asks[1].price.eq(102)).toBe(true);
		expect(snap.asks[2].price.eq(103)).toBe(true);
	});

	it("limit buy above best ask fills then rests remainder", () => {
		const book = new LimitOrderBook("AAPL");

		const ask = makeOrder({
			side: "sell",
			price: new Decimal(100),
			qty: 5,
		});
		book.addOrder(ask, 1);

		// Buy 10 at 102 — fills 5 at 100, rests 5 at 102
		const buy = makeOrder({
			side: "buy",
			price: new Decimal(102),
			qty: 10,
		});
		const trades = book.addOrder(buy, 2);

		expect(trades).toHaveLength(1);
		expect(trades[0].qty).toBe(5);
		expect(buy.status).toBe("partial");
		expect(buy.filledQty).toBe(5);

		const snap = book.getSnapshot();
		expect(snap.asks).toHaveLength(0);
		expect(snap.bids).toHaveLength(1);
		expect(snap.bids[0].price.eq(102)).toBe(true);
		expect(snap.bids[0].qty).toBe(5);
	});

	it("snapshot respects depth parameter", () => {
		const book = new LimitOrderBook("AAPL");

		for (let i = 0; i < 20; i++) {
			book.addOrder(
				makeOrder({ side: "buy", price: new Decimal(100 - i) }),
				1,
			);
		}

		const snap5 = book.getSnapshot(5);
		expect(snap5.bids).toHaveLength(5);

		const snap10 = book.getSnapshot(10);
		expect(snap10.bids).toHaveLength(10);
	});

	it("updates lastPrice on trade", () => {
		const book = new LimitOrderBook("AAPL");

		expect(book.getSnapshot().lastPrice).toBeNull();

		book.addOrder(
			makeOrder({ side: "sell", price: new Decimal(100), qty: 10 }),
			1,
		);
		book.addOrder(
			makeOrder({
				side: "buy",
				type: "market",
				price: new Decimal(0),
				qty: 5,
			}),
			2,
		);

		expect(book.getSnapshot().lastPrice!.eq(100)).toBe(true);
	});
});
