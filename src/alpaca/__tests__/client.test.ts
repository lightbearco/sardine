import { afterEach, describe, expect, it, vi } from "vitest";
import { createAlpacaClient } from "#/alpaca/client";

const TEST_ENV = {
	ALPACA_BASE_URL: "https://paper-api.alpaca.markets",
	ALPACA_API_KEY: "key",
	ALPACA_API_SECRET: "secret",
};

describe("alpaca client", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("normalizes latest quotes and fills missing symbols", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					quotes: {
						AAPL: {
							bp: 100,
							ap: 101,
							t: "2026-04-05T10:00:00Z",
						},
					},
				}),
			}),
		);
		const sdk = {
			timeframeUnit: { DAY: "day" },
			newTimeframe: vi.fn(),
			getMultiBarsV2: vi.fn(),
			createOrder: vi.fn(),
		};
		const client = createAlpacaClient(TEST_ENV, () => sdk as never);

		const quotes = await client.getLatestQuotes(["AAPL", "MSFT"]);

		expect(quotes.get("AAPL")).toMatchObject({
			symbol: "AAPL",
			bidPrice: 100,
			askPrice: 101,
			midPrice: 100.5,
			lastPrice: 100.5,
			spread: 1,
		});
		expect(quotes.get("MSFT")).toMatchObject({
			symbol: "MSFT",
			bidPrice: null,
			askPrice: null,
			midPrice: null,
			lastPrice: null,
		});
	});

	it("normalizes historical bars", async () => {
		const sdk = {
			timeframeUnit: { DAY: "day" },
			newTimeframe: vi.fn().mockReturnValue("1Day"),
			getMultiBarsV2: vi.fn().mockResolvedValue(
				new Map([
					[
						"AAPL",
						[
							{
								Symbol: "AAPL",
								OpenPrice: 99,
								HighPrice: 102,
								LowPrice: 98,
								ClosePrice: 101,
								Volume: 1000,
								Timestamp: "2026-04-04T00:00:00Z",
							},
						],
					],
				]),
			),
			createOrder: vi.fn(),
		};
		const client = createAlpacaClient(TEST_ENV, () => sdk as never);

		const bars = await client.getBars(["AAPL"], "1Day", 60);

		expect(sdk.newTimeframe).toHaveBeenCalledWith(1, "day");
		expect(bars.get("AAPL")).toEqual([
			{
				symbol: "AAPL",
				open: 99,
				high: 102,
				low: 98,
				close: 101,
				volume: 1000,
				timestamp: "2026-04-04T00:00:00Z",
			},
		]);
	});

	it("normalizes latest trades and fills missing symbols with zero fallback", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					trades: {
						AAPL: {
							t: "2026-04-05T10:00:00Z",
							p: 150.5,
							s: 200,
							x: "Q",
							c: ["@", "T"],
							i: 1,
							z: "C",
						},
					},
				}),
			}),
		);
		const sdk = {
			timeframeUnit: { DAY: "day" },
			newTimeframe: vi.fn(),
			getMultiBarsV2: vi.fn(),
			createOrder: vi.fn(),
		};
		const client = createAlpacaClient(TEST_ENV, () => sdk as never);

		const trades = await client.getLatestTrades(["AAPL", "MSFT"]);

		expect(trades.get("AAPL")).toEqual({
			symbol: "AAPL",
			price: 150.5,
			size: 200,
			timestamp: "2026-04-05T10:00:00Z",
			exchange: "Q",
			conditions: ["@", "T"],
		});
		expect(trades.get("MSFT")).toEqual({
			symbol: "MSFT",
			price: 0,
			size: 0,
			timestamp: "",
			exchange: "",
			conditions: [],
		});
	});

	it("normalizes full market snapshots", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					snapshots: {
						AAPL: {
							dailyBar: {
								t: "2026-04-05T00:00:00Z",
								o: 99,
								h: 102,
								l: 98,
								c: 101,
								v: 1000,
							},
							latestTrade: {
								t: "2026-04-05T10:00:00Z",
								p: 101,
								s: 50,
								x: "Q",
								c: [],
								i: 1,
								z: "C",
							},
							latestQuote: {
								bp: 100.5,
								ap: 101.5,
								t: "2026-04-05T10:00:00Z",
							},
							prevDailyBar: {
								t: "2026-04-04T00:00:00Z",
								o: 97,
								h: 100,
								l: 96,
								c: 99,
								v: 800,
							},
						},
					},
				}),
			}),
		);
		const sdk = {
			timeframeUnit: { DAY: "day" },
			newTimeframe: vi.fn(),
			getMultiBarsV2: vi.fn(),
			createOrder: vi.fn(),
		};
		const client = createAlpacaClient(TEST_ENV, () => sdk as never);

		const snapshots = await client.getSnapshots(["AAPL"]);

		expect(snapshots.get("AAPL")).toMatchObject({
			symbol: "AAPL",
			dailyBar: {
				symbol: "AAPL",
				open: 99,
				high: 102,
				low: 98,
				close: 101,
				volume: 1000,
				timestamp: "2026-04-05T00:00:00Z",
			},
			dailyTrade: {
				symbol: "AAPL",
				price: 101,
				size: 50,
				timestamp: "2026-04-05T10:00:00Z",
				exchange: "Q",
				conditions: [],
			},
			dailyQuote: {
				symbol: "AAPL",
				bidPrice: 100.5,
				askPrice: 101.5,
				midPrice: 101,
				spread: 1,
			},
			prevDailyBar: {
				symbol: "AAPL",
				open: 97,
				high: 100,
				low: 96,
				close: 99,
				volume: 800,
				timestamp: "2026-04-04T00:00:00Z",
			},
		});
	});

	it("handles snapshots with missing nested data", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					snapshots: {
						AAPL: {
							dailyBar: {
								t: "2026-04-05T00:00:00Z",
								o: 99,
								h: 102,
								l: 98,
								c: 101,
								v: 1000,
							},
						},
					},
				}),
			}),
		);
		const sdk = {
			timeframeUnit: { DAY: "day" },
			newTimeframe: vi.fn(),
			getMultiBarsV2: vi.fn(),
			createOrder: vi.fn(),
		};
		const client = createAlpacaClient(TEST_ENV, () => sdk as never);

		const snapshots = await client.getSnapshots(["AAPL", "MSFT"]);

		expect(snapshots.get("AAPL")).toMatchObject({
			symbol: "AAPL",
			dailyBar: {
				symbol: "AAPL",
				close: 101,
			},
			dailyTrade: null,
			dailyQuote: null,
			prevDailyBar: null,
		});
		expect(snapshots.get("MSFT")).toEqual({
			symbol: "MSFT",
			dailyBar: null,
			dailyTrade: null,
			dailyQuote: null,
			prevDailyBar: null,
		});
	});

	it("maps submitted orders to normalized results", async () => {
		const sdk = {
			timeframeUnit: { DAY: "day" },
			newTimeframe: vi.fn(),
			getMultiBarsV2: vi.fn(),
			createOrder: vi.fn().mockResolvedValue({
				id: "alpaca-order-1",
				client_order_id: "client-1",
				status: "accepted",
				symbol: "AAPL",
				side: "buy",
				type: "limit",
				qty: "5",
				limit_price: "101.25",
			}),
		};
		const client = createAlpacaClient(TEST_ENV, () => sdk as never);

		const result = await client.submitOrder({
			symbol: "AAPL",
			side: "buy",
			type: "limit",
			qty: 5,
			limitPrice: 101.25,
			clientOrderId: "client-1",
		});

		expect(sdk.createOrder).toHaveBeenCalledWith(
			expect.objectContaining({
				symbol: "AAPL",
				side: "buy",
				type: "limit",
				qty: 5,
				limit_price: 101.25,
				client_order_id: "client-1",
			}),
		);
		expect(result).toEqual({
			id: "alpaca-order-1",
			clientOrderId: "client-1",
			status: "accepted",
			symbol: "AAPL",
			side: "buy",
			type: "limit",
			qty: 5,
			limitPrice: 101.25,
		});
	});
});
