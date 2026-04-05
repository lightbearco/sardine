import { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { AgentConfig, AgentState } from "#/types/agent";
import type { Trade } from "#/types/market";
import { AgentRegistry } from "../AgentRegistry";
import { PortfolioManager } from "../PortfolioManager";

function makeConfig(id: string): AgentConfig {
	return {
		id,
		name: id,
		tier: "tier2",
		entityType: "hedge-fund",
		strategy: "value",
		persona: `${id} persona`,
		currentAgenda: `${id} agenda`,
		investmentThesis: `${id} thesis`,
		quarterlyGoal: `${id} goal`,
		personalityTraits: ["patient"],
		behavioralBiases: ["anchoring"],
		constraints: ["Keep size in check."],
		restrictedSymbols: [],
		sectors: ["tech"],
		risk: 0.4,
		capital: 100_000,
		model: "google/gemini-3.1-flash-lite-preview",
		llmGroup: 0,
		decisionParams: {},
	};
}

function makeState(
	id: string,
	overrides: Partial<AgentState> = {},
): AgentState {
	return {
		id,
		name: id,
		tier: "tier2",
		status: "active",
		strategy: "value",
		llmGroup: 0,
		cash: new Decimal("1000"),
		nav: new Decimal("1000"),
		positions: new Map(),
		openOrders: new Map(),
		researchInbox: new Map(),
		lastAutopilotDirective: null,
		lastLlmTick: null,
		...overrides,
	};
}

function makeRegistry(...states: AgentState[]): AgentRegistry {
	const registry = new AgentRegistry();

	for (const state of states) {
		registry.register({
			config: makeConfig(state.id),
			state,
			requestContext: new RequestContext([["agent-id", state.id]]),
		});
	}

	return registry;
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
	return {
		id: "trade-1",
		buyOrderId: "buy-order-1",
		sellOrderId: "sell-order-1",
		buyerAgentId: "buyer",
		sellerAgentId: "seller",
		symbol: "AAPL",
		price: new Decimal("10"),
		qty: 5,
		tick: 1,
		...overrides,
	};
}

describe("PortfolioManager", () => {
	it("updates buyer and seller cash, positions, and NAV", () => {
		const buyer = makeState("buyer");
		const seller = makeState("seller", {
			positions: new Map([
				[
					"AAPL",
					{
						qty: 10,
						avgCost: new Decimal("8"),
					},
				],
			]),
			nav: new Decimal("1100"),
		});
		const registry = makeRegistry(buyer, seller);
		const manager = new PortfolioManager();

		manager.reconcile(
			[makeTrade()],
			registry,
			new Map([["AAPL", new Decimal("12")]]),
		);

		expect(registry.get("buyer")?.state.cash.eq("950")).toBe(true);
		expect(registry.get("buyer")?.state.positions.get("AAPL")).toMatchObject({
			qty: 5,
		});
		expect(
			registry.get("buyer")?.state.positions.get("AAPL")?.avgCost.eq("10"),
		).toBe(true);
		expect(registry.get("buyer")?.state.nav.eq("1010")).toBe(true);

		expect(registry.get("seller")?.state.cash.eq("1050")).toBe(true);
		expect(registry.get("seller")?.state.positions.get("AAPL")?.qty).toBe(5);
		expect(
			registry.get("seller")?.state.positions.get("AAPL")?.avgCost.eq("8"),
		).toBe(true);
		expect(registry.get("seller")?.state.nav.eq("1110")).toBe(true);
	});

	it("recomputes weighted average cost when increasing a long or short", () => {
		const buyer = makeState("buyer", {
			positions: new Map([
				[
					"AAPL",
					{
						qty: 5,
						avgCost: new Decimal("10"),
					},
				],
			]),
			cash: new Decimal("1000"),
		});
		const seller = makeState("seller", {
			positions: new Map([
				[
					"AAPL",
					{
						qty: -3,
						avgCost: new Decimal("11"),
					},
				],
			]),
			cash: new Decimal("1000"),
		});
		const counterparty = makeState("counterparty", {
			positions: new Map([
				[
					"AAPL",
					{
						qty: 20,
						avgCost: new Decimal("9"),
					},
				],
			]),
			cash: new Decimal("1000"),
		});
		const registry = makeRegistry(buyer, seller, counterparty);
		const manager = new PortfolioManager();

		manager.reconcile(
			[
				makeTrade({
					buyerAgentId: "buyer",
					sellerAgentId: "counterparty",
					qty: 5,
					price: new Decimal("14"),
				}),
				makeTrade({
					id: "trade-2",
					buyOrderId: "buy-order-2",
					sellOrderId: "sell-order-2",
					buyerAgentId: "counterparty",
					sellerAgentId: "seller",
					qty: 2,
					price: new Decimal("13"),
				}),
			],
			registry,
			new Map([["AAPL", new Decimal("13")]]),
		);

		expect(
			registry.get("buyer")?.state.positions.get("AAPL")?.avgCost.eq("12"),
		).toBe(true);
		expect(registry.get("buyer")?.state.positions.get("AAPL")?.qty).toBe(10);

		expect(
			registry.get("seller")?.state.positions.get("AAPL")?.avgCost.eq("11.8"),
		).toBe(true);
		expect(registry.get("seller")?.state.positions.get("AAPL")?.qty).toBe(-5);
	});

	it("keeps avg cost on partial reductions and resets it when crossing zero", () => {
		const seller = makeState("seller", {
			positions: new Map([
				[
					"AAPL",
					{
						qty: 10,
						avgCost: new Decimal("8"),
					},
				],
			]),
			cash: new Decimal("1000"),
		});
		const buyer = makeState("buyer", {
			positions: new Map([
				[
					"AAPL",
					{
						qty: 3,
						avgCost: new Decimal("12"),
					},
				],
			]),
			cash: new Decimal("1000"),
		});
		const registry = makeRegistry(seller, buyer);
		const manager = new PortfolioManager();

		manager.reconcile(
			[
				makeTrade({
					qty: 4,
					price: new Decimal("15"),
				}),
				makeTrade({
					id: "trade-2",
					qty: 12,
					price: new Decimal("9"),
					buyerAgentId: "buyer",
					sellerAgentId: "seller",
				}),
			],
			registry,
			new Map([["AAPL", new Decimal("9")]]),
		);

		expect(registry.get("seller")?.state.positions.get("AAPL")?.qty).toBe(-6);
		expect(
			registry.get("seller")?.state.positions.get("AAPL")?.avgCost.eq("9"),
		).toBe(true);

		expect(registry.get("buyer")?.state.positions.get("AAPL")?.qty).toBe(19);
		expect(
			registry
				.get("buyer")
				?.state.positions.get("AAPL")
				?.avgCost.eq(
					new Decimal("36")
						.plus(new Decimal("60"))
						.plus(new Decimal("108"))
						.div(19),
				),
		).toBe(true);
	});

	it("removes positions that net to zero", () => {
		const buyer = makeState("buyer");
		const seller = makeState("seller", {
			positions: new Map([
				[
					"AAPL",
					{
						qty: 5,
						avgCost: new Decimal("10"),
					},
				],
			]),
		});
		const registry = makeRegistry(buyer, seller);
		const manager = new PortfolioManager();

		manager.reconcile(
			[
				makeTrade({
					qty: 5,
					price: new Decimal("10"),
				}),
			],
			registry,
			new Map([["AAPL", new Decimal("10")]]),
		);

		expect(registry.get("seller")?.state.positions.has("AAPL")).toBe(false);
	});

	it("throws for unknown agents and missing prices", () => {
		const buyer = makeState("buyer");
		const seller = makeState("seller", {
			positions: new Map([
				[
					"AAPL",
					{
						qty: 5,
						avgCost: new Decimal("10"),
					},
				],
			]),
		});
		const registry = makeRegistry(buyer, seller);
		const manager = new PortfolioManager();

		expect(() =>
			manager.reconcile(
				[
					makeTrade({
						buyerAgentId: "missing",
					}),
				],
				registry,
				new Map([["AAPL", new Decimal("10")]]),
			),
		).toThrow("Unknown buyer agent ID: missing");

		expect(() => manager.reconcile([makeTrade()], registry, new Map())).toThrow(
			"Missing latest price for symbol: AAPL",
		);
	});
});
