import { describe, expect, it } from "vitest";
import { planSymbolDataHydration } from "../useSessionDashboard";
import type { SessionSymbolHydration } from "#/types/sim";

const initialSymbolData: SessionSymbolHydration = {
	symbol: "AAPL",
	bars: [
		{
			symbol: "AAPL",
			open: 100,
			high: 101,
			low: 99,
			close: 100.5,
			volume: 1000,
			tick: 10,
		},
	],
	snapshot: {
		symbol: "AAPL",
		bids: [],
		asks: [],
		lastPrice: 100.5,
		spread: 0.02,
	},
	trades: [
		{
			id: "trade-aapl",
			buyOrderId: "buy-aapl",
			sellOrderId: "sell-aapl",
			buyerAgentId: "agent-1",
			sellerAgentId: "agent-2",
			symbol: "AAPL",
			price: 100.5,
			qty: 10,
			tick: 10,
		},
	],
};

describe("planSymbolDataHydration", () => {
	it("uses the route hydration once for the initially selected symbol", () => {
		const plan = planSymbolDataHydration({
			sessionId: "sim-1",
			symbol: "AAPL",
			initialSymbolData,
			hydratedSymbolKey: null,
			watchlist: {
				AAPL: {
					lastBar: initialSymbolData.bars[0] ?? null,
					snapshot: initialSymbolData.snapshot,
				},
			},
		});

		expect(plan.mode).toBe("hydrate");
		expect(plan.symbolData).toBe(initialSymbolData);
	});

	it("switches to symbol-only fetch mode when the user selects a different symbol", () => {
		const plan = planSymbolDataHydration({
			sessionId: "sim-1",
			symbol: "MSFT",
			initialSymbolData,
			hydratedSymbolKey: "sim-1:AAPL",
			watchlist: {
				AAPL: {
					lastBar: initialSymbolData.bars[0] ?? null,
					snapshot: initialSymbolData.snapshot,
				},
				MSFT: {
					lastBar: {
						symbol: "MSFT",
						open: 200,
						high: 202,
						low: 199,
						close: 201,
						volume: 2000,
						tick: 11,
					},
					snapshot: {
						symbol: "MSFT",
						bids: [],
						asks: [],
						lastPrice: 201,
						spread: 0.03,
					},
				},
			},
		});

		expect(plan.mode).toBe("fetch");
		expect(plan.symbolData).toEqual({
			symbol: "MSFT",
			bars: [
				{
					symbol: "MSFT",
					open: 200,
					high: 202,
					low: 199,
					close: 201,
					volume: 2000,
					tick: 11,
				},
			],
			snapshot: {
				symbol: "MSFT",
				bids: [],
				asks: [],
				lastPrice: 201,
				spread: 0.03,
			},
			trades: [],
		});
	});

	it("hydrates again when a different session opens with the same symbol", () => {
		const plan = planSymbolDataHydration({
			sessionId: "sim-2",
			symbol: "AAPL",
			initialSymbolData,
			hydratedSymbolKey: "sim-1:AAPL",
			watchlist: {
				AAPL: {
					lastBar: initialSymbolData.bars[0] ?? null,
					snapshot: initialSymbolData.snapshot,
				},
			},
		});

		expect(plan.mode).toBe("hydrate");
		expect(plan.nextHydratedSymbolKey).toBe("sim-2:AAPL");
	});
});
