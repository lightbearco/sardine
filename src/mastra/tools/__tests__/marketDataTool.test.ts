import { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { marketDataTool } from "#/mastra/tools/marketDataTool";
import type { TradingRequestContextValues } from "#/mastra/trading-context";
import { createToolHarness, unwrapToolResult } from "./test-helpers";

describe("marketDataTool", () => {
	it("returns a JSON-safe order book snapshot", async () => {
		const { requestContext } = createToolHarness();

		const snapshot = unwrapToolResult(await marketDataTool.execute?.(
			{ symbol: "AAPL", depth: 2 },
			{ requestContext },
		));

		expect(snapshot).toBeDefined();
		expect(marketDataTool.outputSchema.parse(snapshot)).toBeDefined();
		expect(snapshot.symbol).toBe("AAPL");
		expect(snapshot.bids).toHaveLength(2);
		expect(snapshot.asks).toHaveLength(2);
		expect(snapshot.bids[0]?.price).toBe("99.95");
		expect(snapshot.asks[0]?.price).toBe("100.05");
		expect(snapshot.spread).toBe("0.1");
	});

	it("throws for unknown symbols", async () => {
		const { requestContext } = createToolHarness();

		await expect(
			marketDataTool.execute?.({ symbol: "MSFT" }, { requestContext }),
		).rejects.toThrow("No order book for symbol: MSFT");
	});

	it("uses the seeded book depth by default and never exceeds available levels", async () => {
		const { requestContext } = createToolHarness();

		const defaultDepth = unwrapToolResult(await marketDataTool.execute?.(
			{ symbol: "AAPL" },
			{ requestContext },
		));
		const requestedDepth = unwrapToolResult(await marketDataTool.execute?.(
			{ symbol: "AAPL", depth: 50 },
			{ requestContext },
		));

		expect(defaultDepth.bids).toHaveLength(3);
		expect(defaultDepth.asks).toHaveLength(3);
		expect(requestedDepth.bids).toHaveLength(3);
		expect(requestedDepth.asks).toHaveLength(3);
	});

	it("returns null spread and lastPrice for a one-sided book", async () => {
		const { engine } = createToolHarness({ seedBooks: false });
		engine.processOrder(
			{
				id: "bid-1",
				symbol: "AAPL",
				side: "buy",
				type: "limit",
				price: new Decimal("99"),
				qty: 10,
				filledQty: 0,
				status: "pending",
				agentId: "agent-2",
				createdAtTick: 1,
			},
			1,
		);
		const requestContext = new RequestContext<TradingRequestContextValues>();
		requestContext.set("matching-engine", engine);

		const snapshot = unwrapToolResult(await marketDataTool.execute?.(
			{ symbol: "AAPL" },
			{ requestContext },
		));

		expect(snapshot.bids).toHaveLength(1);
		expect(snapshot.asks).toEqual([]);
		expect(snapshot.lastPrice).toBeNull();
		expect(snapshot.spread).toBeNull();
	});

	it("throws a helpful error when matching-engine is missing", async () => {
		const requestContext = new RequestContext<TradingRequestContextValues>();

		await expect(
			marketDataTool.execute?.({ symbol: "AAPL" }, { requestContext }),
		).rejects.toThrow(
			"marketDataTool requires a matching-engine in requestContext",
		);
	});
});
