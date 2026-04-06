import { describe, expect, it } from "vitest";
import {
	buildBootstrapMarketData,
	loadBootstrapMarketData,
} from "#/alpaca/live-feed";
import type { AlpacaClient } from "#/alpaca/client";

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
			trades: [],
			snapshot: null,
		});
	});

	it("uses dailyBar.close when snapshot has no dailyQuote", async () => {
		const mockClient: AlpacaClient = {
			getLatestQuotes: async () => new Map(),
			getBars: async () => new Map(),
			getLatestTrades: async () => new Map(),
			getSnapshots: async () =>
				new Map([
					[
						"AAPL",
						{
							symbol: "AAPL",
							dailyBar: {
								symbol: "AAPL",
								open: 210,
								high: 215,
								low: 209,
								close: 213.5,
								volume: 5000,
								timestamp: "2026-04-05T00:00:00Z",
							},
							dailyTrade: null,
							dailyQuote: null,
							prevDailyBar: null,
						},
					],
				]),
			submitOrder: async () => {
				throw new Error("not implemented");
			},
		};

		const marketData = await loadBootstrapMarketData(["AAPL"], mockClient, [
			"snapshots",
		]);

		expect(marketData.symbols.AAPL.midPrice).toBe(213.5);
		expect(marketData.symbols.AAPL.bidPrice).toBe(213.45);
		expect(marketData.symbols.AAPL.askPrice).toBe(213.55);
		expect(marketData.symbols.AAPL.lastPrice).toBe(213.5);
	});

	it("falls back to prevDailyBar.close when dailyBar and dailyQuote are both absent", async () => {
		const mockClient: AlpacaClient = {
			getLatestQuotes: async () => new Map(),
			getBars: async () => new Map(),
			getLatestTrades: async () => new Map(),
			getSnapshots: async () =>
				new Map([
					[
						"AAPL",
						{
							symbol: "AAPL",
							dailyBar: null,
							dailyTrade: null,
							dailyQuote: null,
							prevDailyBar: {
								symbol: "AAPL",
								open: 195,
								high: 200,
								low: 194,
								close: 198.25,
								volume: 3000,
								timestamp: "2026-04-04T00:00:00Z",
							},
						},
					],
				]),
			submitOrder: async () => {
				throw new Error("not implemented");
			},
		};

		const marketData = await loadBootstrapMarketData(["AAPL"], mockClient, [
			"snapshots",
		]);

		expect(marketData.symbols.AAPL.midPrice).toBe(198.25);
		expect(marketData.symbols.AAPL.lastPrice).toBe(198.25);
	});

	it("uses dailyTrade.price when dailyQuote has null prices", async () => {
		const mockClient: AlpacaClient = {
			getLatestQuotes: async () => new Map(),
			getBars: async () => new Map(),
			getLatestTrades: async () => new Map(),
			getSnapshots: async () =>
				new Map([
					[
						"AAPL",
						{
							symbol: "AAPL",
							dailyBar: null,
							dailyTrade: {
								symbol: "AAPL",
								price: 217.8,
								size: 100,
								timestamp: "2026-04-05T10:00:00Z",
								exchange: "Q",
								conditions: [],
							},
							dailyQuote: {
								symbol: "AAPL",
								bidPrice: null,
								askPrice: null,
								midPrice: null,
								lastPrice: null,
								spread: null,
								timestamp: null,
							},
							prevDailyBar: null,
						},
					],
				]),
			submitOrder: async () => {
				throw new Error("not implemented");
			},
		};

		const marketData = await loadBootstrapMarketData(["AAPL"], mockClient, [
			"snapshots",
		]);

		expect(marketData.symbols.AAPL.midPrice).toBe(217.8);
		expect(marketData.symbols.AAPL.lastPrice).toBe(217.8);
		expect(marketData.symbols.AAPL.bidPrice).toBe(217.75);
		expect(marketData.symbols.AAPL.askPrice).toBe(217.85);
	});
});
