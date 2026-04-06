import { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { AgentConfig, AgentState } from "#/types/agent";
import { AgentRegistry, type AgentRegistryEntry } from "../AgentRegistry";
import { TRADING_MODEL } from "#/mastra/models";

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		id: "agent-1",
		name: "Agent 1",
		tier: "tier1",
		entityType: "investment-bank",
		strategy: "momentum",
		persona: "Test persona",
		currentAgenda: "Test agenda",
		investmentThesis: "Test thesis",
		quarterlyGoal: "Test goal",
		personalityTraits: ["disciplined"],
		behavioralBiases: ["anchoring"],
		constraints: ["Do not overtrade."],
		restrictedSymbols: [],
		sectors: ["tech"],
		risk: 0.5,
		capital: 100_000,
		model: TRADING_MODEL,
		llmGroup: 0,
		decisionParams: { threshold: 0.1 },
		...overrides,
	};
}

function makeState(overrides: Partial<AgentState> = {}): AgentState {
	return {
		id: "agent-1",
		name: "Agent 1",
		tier: "tier1",
		status: "active",
		strategy: "momentum",
		llmGroup: 0,
		cash: new Decimal("1000"),
		nav: new Decimal("1500"),
		positions: new Map([
			[
				"AAPL",
				{
					qty: 5,
					avgCost: new Decimal("100.25"),
				},
			],
		]),
		openOrders: new Map([
			[
				"order-1",
				{
					id: "order-1",
					symbol: "AAPL",
					side: "buy",
					type: "limit",
					price: new Decimal("99.5"),
					qty: 5,
					filledQty: 0,
					status: "open",
					agentId: "agent-1",
					createdAtTick: 8,
				},
			],
		]),
		researchInbox: new Map(),
		lastAutopilotDirective: {
			standingOrders: [],
			holdPositions: ["AAPL"],
		},
		lastLlmTick: 10,
		realizedPnl: new Map(),
		pendingFills: [],
		...overrides,
	};
}

function makeEntry(
	overrides: Partial<AgentRegistryEntry> = {},
): AgentRegistryEntry {
	const config = overrides.config ?? makeConfig();
	const state =
		overrides.state ?? makeState({ id: config.id, name: config.name });
	const requestContext =
		overrides.requestContext ?? new RequestContext([["agent-id", config.id]]);

	return {
		config,
		state,
		requestContext,
	};
}

describe("AgentRegistry", () => {
	it("registers and retrieves entries by ID", () => {
		const registry = new AgentRegistry();
		const entry = makeEntry();

		registry.register(entry);

		expect(registry.get(entry.config.id)).toStrictEqual(entry);
	});

	it("returns all entries in insertion order", () => {
		const registry = new AgentRegistry();
		const first = makeEntry();
		const second = makeEntry({
			config: makeConfig({ id: "agent-2", name: "Agent 2", llmGroup: 1 }),
			state: makeState({ id: "agent-2", name: "Agent 2", llmGroup: 1 }),
			requestContext: new RequestContext([["agent-id", "agent-2"]]),
		});

		registry.register(first);
		registry.register(second);

		expect(registry.getAll()).toEqual([first, second]);
	});

	it("filters entries by group and computes the active group", () => {
		const registry = new AgentRegistry();
		const groupZero = makeEntry();
		const groupOne = makeEntry({
			config: makeConfig({ id: "agent-2", name: "Agent 2", llmGroup: 1 }),
			state: makeState({ id: "agent-2", name: "Agent 2", llmGroup: 1 }),
			requestContext: new RequestContext([["agent-id", "agent-2"]]),
		});

		registry.register(groupZero);
		registry.register(groupOne);

		expect(registry.getByGroup(1)).toEqual([groupOne]);
		expect(registry.getActiveGroup(5, 2)).toEqual([groupOne]);
	});

	it("throws on duplicate registration and ID mismatches", () => {
		const registry = new AgentRegistry();
		const entry = makeEntry();

		registry.register(entry);

		expect(() => registry.register(entry)).toThrow(
			"AgentRegistry already contains agent: agent-1",
		);

		expect(() =>
			registry.register(
				makeEntry({
					config: makeConfig({ id: "agent-3" }),
					state: makeState({ id: "agent-4" }),
				}),
			),
		).toThrow("AgentRegistry entry ID mismatch");

		expect(() =>
			registry.register(
				makeEntry({
					config: makeConfig({ id: "agent-5", llmGroup: 1 }),
					state: makeState({ id: "agent-5", llmGroup: 0 }),
				}),
			),
		).toThrow("AgentRegistry entry group mismatch");
	});

	it("throws when updating a missing agent or using an invalid group count", () => {
		const registry = new AgentRegistry();

		expect(() => registry.updateState("missing", { lastLlmTick: 2 })).toThrow(
			"Unknown agent ID: missing",
		);
		expect(() => registry.getActiveGroup(1, 0)).toThrow(
			"groupCount must be greater than 0",
		);
	});

	it("shallow-merges state and preserves positions by default", () => {
		const registry = new AgentRegistry();
		const entry = makeEntry();
		registry.register(entry);

		const previousPositions = entry.state.positions;
		const nextState = registry.updateState(entry.config.id, {
			lastLlmTick: 22,
		});

		expect(nextState.lastLlmTick).toBe(22);
		expect(nextState.positions).toBe(previousPositions);
	});

	it("serializes decimals, maps, and request context into a detached snapshot", () => {
		const registry = new AgentRegistry();
		const entry = makeEntry();
		entry.requestContext.set("persona", "snapshot-test");

		registry.register(entry);

		const snapshot = registry.toSnapshot();

		expect(snapshot["agent-1"].state.cash).toBe("1000");
		expect(snapshot["agent-1"].state.nav).toBe("1500");
		expect(snapshot["agent-1"].state.positions).toEqual({
			AAPL: {
				qty: 5,
				avgCost: "100.25",
			},
		});
		expect(snapshot["agent-1"].state.openOrders).toEqual({
			"order-1": {
				id: "order-1",
				symbol: "AAPL",
				side: "buy",
				type: "limit",
				price: "99.5",
				qty: 5,
				filledQty: 0,
				status: "open",
				agentId: "agent-1",
				createdAtTick: 8,
			},
		});
		expect(snapshot["agent-1"].state.researchInbox).toEqual({});
		expect(snapshot["agent-1"].requestContext).toEqual({
			"agent-id": "agent-1",
			persona: "snapshot-test",
		});

		snapshot["agent-1"].config.sectors.push("finance");
		snapshot["agent-1"].state.positions.AAPL.qty = 999;

		expect(entry.config.sectors).toEqual(["tech"]);
		expect(entry.state.positions.get("AAPL")?.qty).toBe(5);
		expect(entry.state.openOrders.get("order-1")?.price.eq("99.5")).toBe(true);
	});

	it("prunes closed orders from runtime state and exposes DB-friendly rows", () => {
		const registry = new AgentRegistry();
		const entry = makeEntry({
			state: makeState({
				openOrders: new Map([
					[
						"open-order",
						{
							id: "open-order",
							symbol: "AAPL",
							side: "buy",
							type: "limit",
							price: new Decimal("100"),
							qty: 1,
							filledQty: 0,
							status: "open",
							agentId: "agent-1",
							createdAtTick: 1,
						},
					],
					[
						"filled-order",
						{
							id: "filled-order",
							symbol: "AAPL",
							side: "sell",
							type: "limit",
							price: new Decimal("101"),
							qty: 1,
							filledQty: 1,
							status: "filled",
							agentId: "agent-1",
							createdAtTick: 1,
						},
					],
				]),
			}),
		});

		registry.register(entry);

		expect(registry.get("agent-1")?.state.openOrders.has("open-order")).toBe(
			true,
		);
		expect(registry.get("agent-1")?.state.openOrders.has("filled-order")).toBe(
			false,
		);

		const rows = registry.toPersistenceRows("test-session");
		expect(rows).toEqual([
			expect.objectContaining({
				id: "agent-1",
				entityType: "investment-bank",
				modelId: TRADING_MODEL,
				startingCapital: 100_000,
				currentCash: 1000,
				currentNav: 1500,
				positions: {
					AAPL: {
						qty: 5,
						avgCost: 100.25,
					},
				},
			}),
		]);
	});
});
