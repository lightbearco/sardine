import Decimal from "decimal.js";
import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";
import { orderConfirmationSchema, orderTool } from "#/mastra/tools/orderTool";
import type { TradingRequestContextValues } from "#/mastra/trading-context";
import { createToolHarness, unwrapToolResult } from "./test-helpers";

describe("orderTool", () => {
	it("accepts a valid resting limit order and stages it without mutating the registry", async () => {
		const { requestContext, registry } = createToolHarness({
			stateOverrides: {
				nav: new Decimal(100_000),
			},
		});

		const result = unwrapToolResult(await orderTool.execute?.(
			{
				side: "buy",
				type: "limit",
				symbol: "AAPL",
				price: 99,
				qty: 10,
			},
			{ requestContext },
		));

		expect(orderConfirmationSchema.parse(result)).toBeDefined();
		expect(result.status).toBe("pending");
		expect(result.filledQty).toBe(0);
		expect(result.trades).toEqual([]);
		expect(result.rejectionReason).toBeUndefined();
		expect(registry.get("agent-1")?.state.openOrders.has(result.orderId)).toBe(false);
	});

	it("rejects orders for restricted symbols", async () => {
		const { requestContext, registry } = createToolHarness({
			configOverrides: {
				restrictedSymbols: ["AAPL"],
			},
		});

		requestContext.set("restricted-symbols", ["AAPL"]);

		const result = unwrapToolResult(await orderTool.execute?.(
			{
				side: "buy",
				type: "market",
				symbol: "AAPL",
				qty: 5,
			},
			{ requestContext },
		));

		expect(result.status).toBe("cancelled");
		expect(result.rejectionReason).toContain("restricted");
		expect(registry.get("agent-1")?.state.openOrders.size).toBe(0);
	});

	it("rejects orders that breach max position limits", async () => {
		const { requestContext, registry } = createToolHarness({
			configOverrides: {
				decisionParams: {
					maxPositionPct: 0.05,
				},
			},
			stateOverrides: {
				nav: new Decimal(1_000),
			},
		});

		requestContext.set("max-position-pct", 0.05);

		const result = unwrapToolResult(await orderTool.execute?.(
			{
				side: "buy",
				type: "market",
				symbol: "AAPL",
				qty: 1,
			},
			{ requestContext },
		));

		expect(result.status).toBe("cancelled");
		expect(result.rejectionReason).toContain("max position limit");
		expect(registry.get("agent-1")?.state.openOrders.size).toBe(0);
	});

	it("requires a price for limit orders", async () => {
		const { requestContext } = createToolHarness();

		const result = unwrapToolResult(await orderTool.execute?.(
			{
				side: "buy",
				type: "limit",
				symbol: "AAPL",
				qty: 5,
			},
			{ requestContext },
		));

		expect(result.status).toBe("cancelled");
		expect(result.rejectionReason).toContain("require a price");
	});

	it("rejects unknown symbols", async () => {
		const { requestContext } = createToolHarness();

		const result = unwrapToolResult(await orderTool.execute?.(
			{
				side: "buy",
				type: "market",
				symbol: "MSFT",
				qty: 3,
			},
			{ requestContext },
		));

		expect(result.status).toBe("cancelled");
		expect(result.rejectionReason).toContain("Unknown symbol");
	});

	it("enforces max inventory per name constraints", async () => {
		const { requestContext } = createToolHarness({
			stateOverrides: {
				nav: new Decimal(100_000),
			},
		});
		requestContext.set("max-inventory-per-name", 500);

		const result = unwrapToolResult(await orderTool.execute?.(
			{
				side: "buy",
				type: "market",
				symbol: "AAPL",
				qty: 6,
			},
			{ requestContext },
		));

		expect(result.status).toBe("cancelled");
		expect(result.rejectionReason).toContain(
			"max inventory per name limit of 500",
		);
	});

	it("stages a market order without trying to match it immediately", async () => {
		const { requestContext, registry } = createToolHarness();

		const result = unwrapToolResult(await orderTool.execute?.(
			{
				side: "buy",
				type: "market",
				symbol: "AAPL",
				qty: 5,
			},
			{ requestContext },
		));

		expect(result.status).toBe("pending");
		expect(result.filledQty).toBe(0);
		expect(result.price).toBe("0");
		expect(result.trades).toEqual([]);
		expect(registry.get("agent-1")?.state.openOrders.size).toBe(0);
	});

	it("stages oversized market orders without applying fills until orchestration", async () => {
		const { requestContext, registry } = createToolHarness();

		const result = unwrapToolResult(await orderTool.execute?.(
			{
				side: "buy",
				type: "market",
				symbol: "AAPL",
				qty: 151,
			},
			{ requestContext },
		));

		expect(result.status).toBe("pending");
		expect(result.filledQty).toBe(0);
		expect(result.trades).toEqual([]);
		expect(registry.get("agent-1")?.state.openOrders.size).toBe(0);
	});

	it("allows sell orders that reduce exposure while keeping matching deferred", async () => {
		const { requestContext, registry } = createToolHarness({
			positions: {
				AAPL: {
					qty: 10,
					avgCost: new Decimal(95),
				},
			},
		});

		const result = unwrapToolResult(await orderTool.execute?.(
			{
				side: "sell",
				type: "market",
				symbol: "AAPL",
				qty: 4,
			},
			{ requestContext },
		));

		expect(result.status).toBe("pending");
		expect(result.filledQty).toBe(0);
		expect(result.trades).toEqual([]);
		expect(registry.get("agent-1")?.state.openOrders.size).toBe(0);
	});

	it("throws a helpful error when required runtime context is missing", async () => {
		const requestContext = new RequestContext<TradingRequestContextValues>();

		await expect(
			orderTool.execute?.(
				{
					side: "buy",
					type: "market",
					symbol: "AAPL",
					qty: 1,
				},
				{ requestContext },
			),
		).rejects.toThrow(
			"orderTool requires requestContext with agent-registry, matching-engine, sim-tick, and agent-id",
		);
	});
});
