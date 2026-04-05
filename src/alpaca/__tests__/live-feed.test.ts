import { describe, expect, it } from "vitest";
import { buildBootstrapMarketData } from "#/alpaca/live-feed";

describe("live-feed bootstrap market data", () => {
	it("derives fallback prices and spreads from bars when quotes are missing", () => {
		const marketData = buildBootstrapMarketData({
			symbols: ["AAPL"],
			quotes: new Map(),
			bars: new Map([
				[
					"AAPL",
					[
						{
							symbol: "AAPL",
							open: 99,
							high: 102,
							low: 98,
							close: 101,
							volume: 1000,
							timestamp: "2026-04-04T00:00:00Z",
						},
					],
				],
			]),
		});

		expect(marketData.symbols.AAPL).toEqual({
			symbol: "AAPL",
			bidPrice: 100.95,
			askPrice: 101.05,
			midPrice: 101,
			lastPrice: 101,
			spread: 0.1,
			bars: [
				{
					symbol: "AAPL",
					open: 99,
					high: 102,
					low: 98,
					close: 101,
					volume: 1000,
					timestamp: "2026-04-04T00:00:00Z",
				},
			],
		});
	});
});
