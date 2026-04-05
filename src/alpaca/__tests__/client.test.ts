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
							BidPrice: 100,
							AskPrice: 101,
							Timestamp: "2026-04-05T10:00:00Z",
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
