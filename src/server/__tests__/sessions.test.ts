import { beforeEach, describe, expect, it, vi } from "vitest";

const selectQueue: unknown[][] = [];

function queueSelectResult(result: unknown[]) {
	selectQueue.push(result);
}

function dequeueSelectResult() {
	const next = selectQueue.shift();
	if (!next) {
		throw new Error("No queued select result for mock db");
	}

	return next;
}

function createSelectQuery(result: unknown[]) {
	const query = {
		from: () => query,
		where: () => query,
		orderBy: () => query,
		limit: () => Promise.resolve(result),
		then: (onFulfilled: (value: unknown[]) => unknown) =>
			Promise.resolve(onFulfilled(result)),
	};

	return query;
}

vi.mock("#/db/index", () => ({
	db: {
		select: vi.fn(() => createSelectQuery(dequeueSelectResult())),
		execute: vi.fn(() => Promise.resolve({ rows: dequeueSelectResult() })),
	},
}));

describe("getSessionDashboardHydration", () => {
	beforeEach(() => {
		selectQueue.length = 0;
	});

	it("hydrates the requested session with full sim state, roster, and agent events", async () => {
		queueSelectResult([
			{
				id: "sim_123",
				name: "Simulation",
				status: "active",
				symbols: ["AAPL", "NVDA"],
				seed: 42,
				agentCount: 50,
				groupCount: 10,
				tickIntervalMs: 1000,
				simulatedTickDuration: 5,
				traderDistribution: {
					tier1: 2,
					hedgeFund: 3,
					marketMaker: 3,
					pension: 2,
					momentum: 15,
					value: 10,
					noise: 10,
					depthProvider: 5,
				},
				createdAt: new Date("2026-04-05T10:00:00.000Z"),
				updatedAt: new Date("2026-04-05T10:10:00.000Z"),
				startedAt: new Date("2026-04-05T10:00:00.000Z"),
				endedAt: null,
			},
		]);
		queueSelectResult([
			{
				id: 1,
				sessionId: "sim_123",
				isRunning: true,
				currentTick: 10,
				simulatedMarketTime: new Date("2026-04-05T10:10:00.000Z"),
				speedMultiplier: 2,
				tickIntervalMs: 500,
				lastSummary: {
					durationMs: 88,
					orderCount: 4,
					tradeCount: 1,
					activeAgents: 1,
					simTick: 10,
					simulatedTime: "2026-04-05T10:10:00.000Z",
					trades: [
						{
							id: "trade-1",
							buyOrderId: "buy-1",
							sellOrderId: "sell-1",
							buyerAgentId: "agent-1",
							sellerAgentId: "agent-2",
							symbol: "NVDA",
							price: "101.25",
							qty: 10,
							tick: 10,
						},
					],
					isRunning: true,
				},
				seed: 42,
				createdAt: new Date("2026-04-05T10:00:00.000Z"),
				updatedAt: new Date("2026-04-05T10:10:00.000Z"),
			},
		]);
		queueSelectResult([
			{
				id: 1,
				sessionId: "sim_123",
				symbol: "NVDA",
				tick: 10,
				bids: [],
				asks: [],
				lastPrice: 101.5,
				spread: 0.1,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);
		queueSelectResult([]);
		queueSelectResult([
			{
				id: "agent-1",
				sessionId: "sim_123",
				name: "Bridgewater",
				tier: "tier1",
				status: "active",
				entityType: "hedge-fund",
				strategyType: "macro",
				modelId: null,
				persona: null,
				mandateSectors: [],
				riskTolerance: 0.5,
				startingCapital: 1_000_000,
				currentCash: 900_000,
				currentNav: 1_050_000,
				positions: {},
				parameters: {},
				lastAutopilotDirective: null,
				lastLlmAt: new Date("2026-04-05T10:10:00.000Z"),
				llmGroup: 0,
				createdAt: new Date(),
			},
			{
				id: "agent-2",
				sessionId: "sim_123",
				name: "Tiger",
				tier: "tier2",
				status: "active",
				entityType: "hedge-fund",
				strategyType: "growth",
				modelId: null,
				persona: null,
				mandateSectors: [],
				riskTolerance: 0.5,
				startingCapital: 1_000_000,
				currentCash: 900_000,
				currentNav: 1_030_000,
				positions: {},
				parameters: {},
				lastAutopilotDirective: null,
				lastLlmAt: new Date("2026-04-05T10:10:00.000Z"),
				llmGroup: 1,
				createdAt: new Date(),
			},
		]);
		queueSelectResult([
			{
				eventId: "event-1",
				sessionId: "sim_123",
				agentId: "agent-1",
				type: "signal",
				tick: 10,
				payload: {
					eventId: "event-1",
					type: "signal",
					agentId: "agent-1",
					agentName: "Bridgewater",
					tick: 10,
					signal: {
						agentId: "agent-1",
						agentName: "Bridgewater",
						side: "buy",
						symbol: "NVDA",
						price: 101.25,
						qty: 10,
						reasoning: "Momentum improving.",
						tick: 10,
					},
				},
				createdAt: new Date(),
			},
		]);
		queueSelectResult([]);
		queueSelectResult([
			{
				id: 2,
				sessionId: "sim_123",
				tick: 10,
				symbol: "NVDA",
				open: 100,
				high: 102,
				low: 99,
				close: 101,
				volume: 1000,
				createdAt: new Date(),
			},
		]);
		queueSelectResult([{ symbol: "NVDA", divergencePct: 1.5 }]);
		queueSelectResult([
			{
				id: "sim_123",
				name: "Simulation",
				status: "active",
				symbols: ["AAPL", "NVDA"],
				seed: 42,
				agentCount: 50,
				groupCount: 10,
				tickIntervalMs: 1000,
				simulatedTickDuration: 5,
				traderDistribution: {
					tier1: 2,
					hedgeFund: 3,
					marketMaker: 3,
					pension: 2,
					momentum: 15,
					value: 10,
					noise: 10,
					depthProvider: 5,
				},
				createdAt: new Date("2026-04-05T10:00:00.000Z"),
				updatedAt: new Date("2026-04-05T10:10:00.000Z"),
				startedAt: new Date("2026-04-05T10:00:00.000Z"),
				endedAt: null,
			},
		]);
		queueSelectResult([
			{
				id: 2,
				sessionId: "sim_123",
				tick: 10,
				symbol: "NVDA",
				open: 100,
				high: 102,
				low: 99,
				close: 101,
				volume: 1000,
				createdAt: new Date(),
			},
		]);
		queueSelectResult([
			{
				id: "trade-1",
				sessionId: "sim_123",
				tick: 10,
				symbol: "NVDA",
				buyOrderId: "buy-1",
				sellOrderId: "sell-1",
				buyerAgentId: "agent-1",
				sellerAgentId: "agent-2",
				price: 101.25,
				quantity: 10,
				createdAt: new Date(),
			},
		]);
		queueSelectResult([
			{
				id: 1,
				sessionId: "sim_123",
				symbol: "NVDA",
				tick: 10,
				bids: [],
				asks: [],
				lastPrice: 101.5,
				spread: 0.1,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);

		const { getSessionDashboardHydration, getSessionSymbolHydration } =
			await import("../sessions");
		const hydration = await getSessionDashboardHydration({
			sessionId: "sim_123",
		});
		const symbolHydration = await getSessionSymbolHydration({
			sessionId: "sim_123",
			symbol: "NVDA",
		});

		expect(hydration?.simState).toMatchObject({
			simTick: 10,
			activeGroupIndex: 0,
			activeGroupSize: 1,
			agentCount: 2,
			speedMultiplier: 2,
		});
		expect(hydration?.simState?.lastSummary?.durationMs).toBe(88);
		expect(hydration?.agentRoster).toHaveLength(2);
		expect(hydration?.agentEvents).toHaveLength(1);
		expect(hydration?.agentEvents[0]?.eventId).toBe("event-1");
		expect(hydration?.watchlist.NVDA?.snapshot?.lastPrice).toBe(101.5);
		expect(symbolHydration?.symbol).toBe("NVDA");
		expect(symbolHydration?.snapshot?.lastPrice).toBe(101.5);
		expect(symbolHydration?.bars).toHaveLength(1);
		expect(symbolHydration?.trades).toHaveLength(1);
	});

	it("synthesizes fallback watchlist and symbol hydration for missing legacy symbols", async () => {
		queueSelectResult([
			{
				id: "sim_legacy",
				name: "Legacy Simulation",
				status: "active",
				symbols: ["AAPL", "MSFT"],
				seed: 42,
				agentCount: 2,
				groupCount: 2,
				tickIntervalMs: 1000,
				simulatedTickDuration: 5,
				traderDistribution: {
					tier1: 1,
					hedgeFund: 0,
					marketMaker: 0,
					pension: 0,
					momentum: 1,
					value: 0,
					noise: 0,
					depthProvider: 0,
				},
				createdAt: new Date("2026-04-05T10:00:00.000Z"),
				updatedAt: new Date("2026-04-05T10:10:00.000Z"),
				startedAt: new Date("2026-04-05T10:00:00.000Z"),
				endedAt: null,
			},
		]);
		queueSelectResult([
			{
				id: 1,
				sessionId: "sim_legacy",
				isRunning: true,
				currentTick: 8,
				simulatedMarketTime: new Date("2026-04-05T10:08:00.000Z"),
				speedMultiplier: 1,
				tickIntervalMs: 1000,
				lastSummary: null,
				seed: 42,
				createdAt: new Date("2026-04-05T10:00:00.000Z"),
				updatedAt: new Date("2026-04-05T10:08:00.000Z"),
			},
		]);
		queueSelectResult([
			{
				id: 1,
				sessionId: "sim_legacy",
				symbol: "AAPL",
				tick: 8,
				bids: [{ price: 150.1, qty: 10, orderCount: 1 }],
				asks: [{ price: 150.2, qty: 10, orderCount: 1 }],
				lastPrice: 150.15,
				spread: 0.1,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([
			{
				id: 2,
				sessionId: "sim_legacy",
				tick: 8,
				symbol: "AAPL",
				open: 150,
				high: 151,
				low: 149,
				close: 150.5,
				volume: 1200,
				createdAt: new Date(),
			},
		]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([
			{
				id: "sim_legacy",
				name: "Legacy Simulation",
				status: "active",
				symbols: ["AAPL", "MSFT"],
				seed: 42,
				agentCount: 2,
				groupCount: 2,
				tickIntervalMs: 1000,
				simulatedTickDuration: 5,
				traderDistribution: {
					tier1: 1,
					hedgeFund: 0,
					marketMaker: 0,
					pension: 0,
					momentum: 1,
					value: 0,
					noise: 0,
					depthProvider: 0,
				},
				createdAt: new Date("2026-04-05T10:00:00.000Z"),
				updatedAt: new Date("2026-04-05T10:10:00.000Z"),
				startedAt: new Date("2026-04-05T10:00:00.000Z"),
				endedAt: null,
			},
		]);
		queueSelectResult([]);
		queueSelectResult([]);
		queueSelectResult([]);

		const { getSessionDashboardHydration, getSessionSymbolHydration } =
			await import("../sessions");
		const hydration = await getSessionDashboardHydration({
			sessionId: "sim_legacy",
		});
		const symbolHydration = await getSessionSymbolHydration({
			sessionId: "sim_legacy",
			symbol: "MSFT",
		});

		expect(hydration?.watchlist.AAPL?.lastBar?.close).toBe(150.5);
		expect(hydration?.watchlist.MSFT?.lastBar?.close).toBe(150);
		expect(hydration?.watchlist.MSFT?.snapshot?.lastPrice).toBe(150);
		expect(hydration?.watchlist.MSFT?.snapshot?.bids[0]?.price).toBe(149.95);
		expect(hydration?.watchlist.MSFT?.snapshot?.asks[0]?.price).toBe(150.05);
		expect(symbolHydration?.symbol).toBe("MSFT");
		expect(symbolHydration?.bars).toEqual([
			{
				symbol: "MSFT",
				open: 150,
				high: 150,
				low: 150,
				close: 150,
				volume: 0,
				tick: 0,
			},
		]);
		expect(symbolHydration?.snapshot?.lastPrice).toBe(150);
		expect(symbolHydration?.trades).toEqual([]);
	});
});
