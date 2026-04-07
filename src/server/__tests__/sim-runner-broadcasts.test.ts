import { describe, expect, it } from "vitest";
import { mergeWatchlistSummary } from "../sim-runner-broadcasts";

describe("sim-runner broadcasts", () => {
	it("fills an empty watchlist summary from incoming trade and snapshot patches", () => {
		const merged = mergeWatchlistSummary(
			undefined,
			{
				symbol: "MSFT",
				lastTrade: {
					id: "trade-1",
					tick: 1,
					symbol: "MSFT",
					price: 412.5,
					qty: 10,
					buyerAgentId: "buyer-1",
					sellerAgentId: "seller-1",
					buyOrderId: "buy-1",
					sellOrderId: "sell-1",
				},
				snapshot: {
					symbol: "MSFT",
					lastPrice: 412.5,
					spread: 0.25,
					bids: [],
					asks: [],
				},
			},
			1234,
		);

		expect(merged).toEqual({
			symbol: "MSFT",
			lastPrice: 412.5,
			high: null,
			low: null,
			spread: 0.25,
			lastBar: undefined,
			snapshot: {
				symbol: "MSFT",
				lastPrice: 412.5,
				spread: 0.25,
				bids: [],
				asks: [],
			},
			lastTrade: {
				id: "trade-1",
				tick: 1,
				symbol: "MSFT",
				price: 412.5,
				qty: 10,
				buyerAgentId: "buyer-1",
				sellerAgentId: "seller-1",
				buyOrderId: "buy-1",
				sellOrderId: "sell-1",
			},
			updatedAt: 1234,
		});
	});

	it("preserves prior fields when a patch only updates the last bar", () => {
		const merged = mergeWatchlistSummary(
			{
				symbol: "NVDA",
				lastPrice: 101.25,
				high: 105,
				low: 99.5,
				spread: 0.1,
				lastTrade: {
					id: "trade-1",
					tick: 3,
					symbol: "NVDA",
					price: 101.25,
					qty: 20,
					buyerAgentId: "buyer-1",
					sellerAgentId: "seller-1",
					buyOrderId: "buy-1",
					sellOrderId: "sell-1",
				},
				updatedAt: 1000,
			},
			{
				lastBar: {
					symbol: "NVDA",
					tick: 4,
					open: 101,
					high: 106,
					low: 100.5,
					close: 104.5,
					volume: 1500,
				},
			},
			2000,
		);

		expect(merged.lastPrice).toBe(104.5);
		expect(merged.high).toBe(106);
		expect(merged.low).toBe(100.5);
		expect(merged.spread).toBe(0.1);
		expect(merged.lastTrade?.id).toBe("trade-1");
		expect(merged.updatedAt).toBe(2000);
	});
});
