import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { AgentState } from "#/types/agent";
import { executeAutopilot } from "../autopilot";

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
	return {
		id: "agent-1",
		name: "Agent 1",
		tier: "tier3",
		status: "active",
		strategy: "momentum",
		llmGroup: 0,
		cash: new Decimal("1000"),
		nav: new Decimal("1000"),
		positions: new Map(),
		openOrders: new Map(),
		researchInbox: new Map(),
		lastAutopilotDirective: {
			standingOrders: [
				{
					symbol: "AAPL",
					side: "buy",
					type: "limit",
					price: 100,
					qty: 10,
				},
			],
			holdPositions: ["AAPL"],
		},
		lastLlmTick: null,
		...overrides,
	};
}

describe("executeAutopilot", () => {
	it("keeps matching standing orders without emitting duplicates", () => {
		const agent = makeAgentState({
			openOrders: new Map([
				[
					"existing-1",
					{
						id: "existing-1",
						symbol: "AAPL",
						side: "buy",
						type: "limit",
						price: new Decimal("100"),
						qty: 10,
						filledQty: 0,
						status: "open",
						agentId: "agent-1",
						createdAtTick: 5,
					},
				],
			]),
		});

		const result = executeAutopilot(agent, new Map([["AAPL", 99.5]]), 12);

		expect(result.orders).toEqual([]);
		expect(result.cancelOrderIds).toEqual([]);
		expect(result.urgentReview).toBe(false);
	});

	it("emits missing standing orders, cancels by threshold, and flags urgent review", () => {
		const agent = makeAgentState({
			openOrders: new Map([
				[
					"cancel-me",
					{
						id: "cancel-me",
						symbol: "AAPL",
						side: "buy",
						type: "limit",
						price: new Decimal("100"),
						qty: 10,
						filledQty: 0,
						status: "open",
						agentId: "agent-1",
						createdAtTick: 5,
					},
				],
			]),
			lastAutopilotDirective: {
				standingOrders: [
					{
						symbol: "AAPL",
						side: "buy",
						type: "limit",
						price: 100,
						qty: 10,
					},
					{
						symbol: "MSFT",
						side: "sell",
						type: "market",
						qty: 4,
					},
				],
				holdPositions: ["AAPL", "MSFT"],
				cancelIf: { symbol: "AAPL", condition: "price >= 101" },
				urgentReviewIf: { symbol: "MSFT", condition: "price < 200" },
			},
		});

		const result = executeAutopilot(
			agent,
			new Map([
				["AAPL", 101],
				["MSFT", 199],
			]),
			15,
		);

		expect(result.cancelOrderIds).toEqual(["cancel-me"]);
		expect(result.orders).toEqual([
			expect.objectContaining({
				id: "autopilot:agent-1:15:1:MSFT:sell:market:market:4",
				symbol: "MSFT",
				side: "sell",
				type: "market",
				qty: 4,
				createdAtTick: 15,
			}),
		]);
		expect(result.orders[0].price.eq(0)).toBe(true);
		expect(result.urgentReview).toBe(true);
	});
});
