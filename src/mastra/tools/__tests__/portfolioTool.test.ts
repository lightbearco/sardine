import Decimal from "decimal.js";
import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { portfolioTool } from "#/mastra/tools/portfolioTool";
import type { TradingRequestContextValues } from "#/mastra/trading-context";
import { createToolHarness, unwrapToolResult } from "./test-helpers";

describe("portfolioTool", () => {
	it("returns positions, open orders, and mark-to-market P&L", async () => {
		const { requestContext } = createToolHarness({
			positions: {
				AAPL: {
					qty: 10,
					avgCost: new Decimal(90),
				},
			},
			openOrders: [
				{
					id: "open-1",
					symbol: "AAPL",
					side: "buy",
					type: "limit",
					price: new Decimal(95),
					qty: 5,
					filledQty: 0,
					status: "open",
					agentId: "agent-1",
					createdAtTick: 1,
				},
			],
			stateOverrides: {
				cash: new Decimal(99_900),
				nav: new Decimal(101_000),
			},
		});

		const result = unwrapToolResult(
			await portfolioTool.execute?.({}, { requestContext }),
		);

		const outputSchema = portfolioTool.outputSchema as z.ZodTypeAny;
		expect(outputSchema.parse(result)).toBeDefined();
		expect(result.agentId).toBe("agent-1");
		expect(result.capital).toBe("100000");
		expect(result.totalPnl).toBe("1000");
		expect(result.positions).toEqual([
			{
				symbol: "AAPL",
				qty: 10,
				avgCost: "90",
				markPrice: "100",
				marketValue: "1000",
				unrealizedPnl: "100",
				weightPct: "0.99",
				realizedPnl: "0",
			},
		]);
		expect(result.openOrders).toEqual([
			{
				orderId: "open-1",
				symbol: "AAPL",
				side: "buy",
				type: "limit",
				price: "95",
				qty: 5,
				filledQty: 0,
				status: "open",
				createdAtTick: 1,
			},
		]);
	});

	it("supports filtering by symbol", async () => {
		const { requestContext } = createToolHarness({
			symbols: ["AAPL", "MSFT"],
			positions: {
				AAPL: {
					qty: 10,
					avgCost: new Decimal(90),
				},
				MSFT: {
					qty: 5,
					avgCost: new Decimal(250),
				},
			},
		});

		const result = unwrapToolResult(
			await portfolioTool.execute?.({ symbol: "MSFT" }, { requestContext }),
		);

		expect(result.positions).toHaveLength(1);
		expect(result.positions[0]?.symbol).toBe("MSFT");
	});

	it("prefers lastPrice over midpoint and falls back to avgCost if no book pricing exists", async () => {
		const lastPriceHarness = createToolHarness({
			positions: {
				AAPL: {
					qty: 5,
					avgCost: new Decimal(90),
				},
			},
		});
		lastPriceHarness.engine.processOrder(
			{
				id: "aggressive-buy",
				symbol: "AAPL",
				side: "buy",
				type: "market",
				price: new Decimal(0),
				qty: 5,
				filledQty: 0,
				status: "pending",
				agentId: "agent-3",
				createdAtTick: 2,
			},
			2,
		);

		const avgCostHarness = createToolHarness({
			seedBooks: false,
			positions: {
				AAPL: {
					qty: -3,
					avgCost: new Decimal(87),
				},
			},
		});

		const lastPriceResult = unwrapToolResult(
			await portfolioTool.execute?.(
				{},
				{ requestContext: lastPriceHarness.requestContext },
			),
		);
		const avgCostResult = unwrapToolResult(
			await portfolioTool.execute?.(
				{},
				{ requestContext: avgCostHarness.requestContext },
			),
		);

		expect(lastPriceResult.positions[0]?.markPrice).toBe("100.05");
		expect(avgCostResult.positions[0]).toEqual({
			symbol: "AAPL",
			qty: -3,
			avgCost: "87",
			markPrice: "87",
			marketValue: "-261",
			unrealizedPnl: "0",
			weightPct: "-0.26",
			realizedPnl: "0",
		});
	});

	it("returns empty arrays when a symbol filter matches nothing and serializes active order statuses", async () => {
		const { requestContext } = createToolHarness({
			openOrders: [
				{
					id: "pending-1",
					symbol: "AAPL",
					side: "buy",
					type: "limit",
					price: new Decimal(99),
					qty: 5,
					filledQty: 0,
					status: "pending",
					agentId: "agent-1",
					createdAtTick: 1,
				},
				{
					id: "partial-1",
					symbol: "AAPL",
					side: "sell",
					type: "limit",
					price: new Decimal(101),
					qty: 5,
					filledQty: 2,
					status: "partial",
					agentId: "agent-1",
					createdAtTick: 2,
				},
				{
					id: "cancelled-1",
					symbol: "AAPL",
					side: "sell",
					type: "limit",
					price: new Decimal(102),
					qty: 4,
					filledQty: 0,
					status: "cancelled",
					agentId: "agent-1",
					createdAtTick: 3,
				},
			],
		});

		const filtered = unwrapToolResult(
			await portfolioTool.execute?.({ symbol: "MSFT" }, { requestContext }),
		);
		const allOrders = unwrapToolResult(
			await portfolioTool.execute?.({}, { requestContext }),
		);

		expect(filtered.positions).toEqual([]);
		expect(filtered.openOrders).toEqual([]);
		expect(allOrders.openOrders).toEqual([
			expect.objectContaining({ orderId: "pending-1", status: "pending" }),
			expect.objectContaining({ orderId: "partial-1", status: "partial" }),
		]);
	});

	it("throws a helpful error when required runtime context is missing", async () => {
		const requestContext = new RequestContext<TradingRequestContextValues>();

		await expect(
			portfolioTool.execute?.({}, { requestContext }),
		).rejects.toThrow(
			"portfolioTool requires agent-registry, matching-engine, agent-id, and capital in requestContext",
		);
	});
});
