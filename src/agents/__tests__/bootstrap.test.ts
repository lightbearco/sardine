import { beforeEach, describe, expect, it, vi } from "vitest";

const insertCalls: Array<{ table: unknown; values: unknown }> = [];

vi.mock("#/db/index", () => ({
	db: {
		transaction: async (callback: (tx: any) => Promise<void>) => {
			const tx = {
				insert: (table: unknown) => ({
					values: async (values: unknown) => {
						insertCalls.push({ table, values });
					},
				}),
			};

			await callback(tx);
		},
	},
}));

describe("bootstrapSimulation", () => {
	beforeEach(() => {
		insertCalls.length = 0;
	});

	it("uses Alpaca market data to seed books, positions, and historical bars", async () => {
		const { bootstrapSimulation } = await import("#/agents/bootstrap");
		const result = await bootstrapSimulation({
			sessionId: "sim_test",
			symbols: ["AAPL", "MSFT"],
			seed: 42,
			agentCount: 4,
			groupCount: 4,
			tickIntervalMs: 750,
			simulatedTickDuration: 5,
			traderDistribution: {
				tier1: 2,
				hedgeFund: 1,
				marketMaker: 1,
				pension: 0,
				momentum: 0,
				value: 0,
				noise: 0,
				depthProvider: 0,
			},
			marketData: {
				symbols: {
					AAPL: {
						symbol: "AAPL",
						bidPrice: 100,
						askPrice: 100.2,
						midPrice: 100.1,
						lastPrice: 100.15,
						spread: 0.2,
						bars: Array.from({ length: 60 }, (_, index) => ({
							symbol: "AAPL",
							open: 90 + index,
							high: 91 + index,
							low: 89 + index,
							close: 90.5 + index,
							volume: 1000 + index,
							timestamp: `2026-02-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
						})),
						trades: [],
						snapshot: null,
					},
					MSFT: {
						symbol: "MSFT",
						bidPrice: 250,
						askPrice: 250.4,
						midPrice: 250.2,
						lastPrice: 250.3,
						spread: 0.4,
						bars: Array.from({ length: 60 }, (_, index) => ({
							symbol: "MSFT",
							open: 240 + index,
							high: 241 + index,
							low: 239 + index,
							close: 240.5 + index,
							volume: 2000 + index,
							timestamp: `2026-02-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
						})),
						trades: [],
						snapshot: null,
					},
				},
			},
		});

		expect(result.initialTick).toBe(60);
		expect(
			result.matchingEngine.getSnapshot("AAPL").bids[0]?.price.toNumber(),
		).toBe(100);
		expect(
			result.matchingEngine.getSnapshot("AAPL").asks[0]?.price.toNumber(),
		).toBe(100.2);

		const agentWithPositions = result.agentRegistry
			.getAll()
			.find((entry) => entry.state.positions.size > 0);
		expect(agentWithPositions).toBeDefined();
		expect(agentWithPositions!.state.cash.toNumber()).toBeLessThan(
			agentWithPositions!.config.capital,
		);

		const tickInsert = insertCalls.find(
			(call) =>
				Array.isArray(call.values) &&
				call.values.some(
					(row: any) =>
						row.sessionId === "sim_test" &&
						row.symbol === "AAPL" &&
						row.tick === 60,
				),
		);
		expect(tickInsert).toBeDefined();
	});

	it("falls back to local seed prices when Alpaca data is absent", async () => {
		const { bootstrapSimulation } = await import("#/agents/bootstrap");
		const result = await bootstrapSimulation({
			sessionId: "sim_fallback",
			symbols: ["AAPL"],
			seed: 42,
			agentCount: 2,
			groupCount: 2,
			tickIntervalMs: 1000,
			simulatedTickDuration: 5,
			traderDistribution: {
				tier1: 2,
				hedgeFund: 0,
				marketMaker: 0,
				pension: 0,
				momentum: 0,
				value: 0,
				noise: 0,
				depthProvider: 0,
			},
			marketData: null,
		});

		expect(result.initialTick).toBe(0);
		expect(
			result.matchingEngine.getSnapshot("AAPL").bids[0]?.price.toNumber(),
		).toBe(149.95);
		expect(
			result.matchingEngine.getSnapshot("AAPL").asks[0]?.price.toNumber(),
		).toBe(150.05);
	});

	it("restores persisted runtime state, open orders, and tick metadata", async () => {
		const { bootstrapSimulation, restoreSimulation } = await import(
			"#/agents/bootstrap"
		);
		const bootstrap = await bootstrapSimulation({
			sessionId: "sim_restore",
			symbols: ["AAPL"],
			seed: 42,
			agentCount: 2,
			groupCount: 2,
			tickIntervalMs: 1000,
			simulatedTickDuration: 5,
			traderDistribution: {
				tier1: 2,
				hedgeFund: 0,
				marketMaker: 0,
				pension: 0,
				momentum: 0,
				value: 0,
				noise: 0,
				depthProvider: 0,
			},
			marketData: null,
		});
		const restoredAgent = bootstrap.agentRegistry.getAll()[0];
		const resumed = restoreSimulation({
			sessionId: "sim_restore",
			symbols: ["AAPL"],
			seed: 42,
			agentCount: 2,
			groupCount: 2,
			tickIntervalMs: 1000,
			simulatedTickDuration: 5,
			traderDistribution: {
				tier1: 2,
				hedgeFund: 0,
				marketMaker: 0,
				pension: 0,
				momentum: 0,
				value: 0,
				noise: 0,
				depthProvider: 0,
			},
			persistedState: {
				simConfig: {
					isRunning: false,
					currentTick: 12,
					simulatedMarketTime: new Date("2026-04-05T14:30:00.000Z"),
					speedMultiplier: 2,
					tickIntervalMs: 750,
					lastSummary: {
						durationMs: 88,
						orderCount: 3,
						tradeCount: 1,
						activeAgents: 1,
						simTick: 12,
						simulatedTime: new Date("2026-04-05T14:30:00.000Z"),
						trades: [
							{
								id: "trade-1",
								buyOrderId: "buy-1",
								sellOrderId: "sell-1",
								buyerAgentId: restoredAgent.config.id,
								sellerAgentId: "sim_restore:market-maker-seed",
								symbol: "AAPL",
								price: 150.12 as never,
								qty: 5,
								tick: 12,
							},
						] as never,
						isRunning: false,
					},
				},
				agents: [
					{
						id: restoredAgent.config.id,
						status: "paused",
						currentCash: 12345,
						currentNav: 12567,
						positions: {
							AAPL: {
								qty: 7,
								avgCost: 149.8,
							},
						},
						lastAutopilotDirective: {
							standingOrders: [],
							holdPositions: ["AAPL"],
						},
						llmGroup: restoredAgent.config.llmGroup,
					},
				],
				openOrders: [
					{
						id: "order-1",
						tick: 12,
						agentId: restoredAgent.config.id,
						symbol: "AAPL",
						type: "limit",
						side: "buy",
						status: "open",
						price: 149.9,
						quantity: 4,
						filledQuantity: 0,
						llmReasoning: "resting bid",
					},
					{
						id: "seed-ask-1",
						tick: 12,
						agentId: "sim_restore:market-maker-seed",
						symbol: "AAPL",
						type: "limit",
						side: "sell",
						status: "open",
						price: 150.3,
						quantity: 10,
						filledQuantity: 0,
						llmReasoning: null,
					},
				],
				researchNotes: [
					{
						id: "note-1",
						agentId: "sim_restore:research-news",
						focus: "news",
						headline: "Desk note",
						body: "Something happened.",
						sentiment: "bullish",
						confidence: 0.82,
						symbols: ["AAPL"],
						sources: ["https://example.com"],
						publishedAtTick: 10,
						releasedToTier: "tier1",
					},
				],
				agentEventCount: 9,
			},
		});

		const restoredEntry = resumed.agentRegistry.get(restoredAgent.config.id);
		expect(restoredEntry?.state.status).toBe("paused");
		expect(restoredEntry?.state.cash.toNumber()).toBe(12345);
		expect(restoredEntry?.state.nav.toNumber()).toBe(12567);
		expect(restoredEntry?.state.positions.get("AAPL")?.avgCost.toNumber()).toBe(
			149.8,
		);
		expect(
			restoredEntry?.state.openOrders.get("order-1")?.price.toNumber(),
		).toBe(149.9);
		expect(
			resumed.matchingEngine.getSnapshot("AAPL").bids[0]?.price.toNumber(),
		).toBe(149.9);
		expect(resumed.runtimeState.currentTick).toBe(12);
		expect(resumed.runtimeState.isRunning).toBe(false);
		expect(resumed.runtimeState.speedMultiplier).toBe(2);
		expect(resumed.runtimeState.tickIntervalMs).toBe(750);
		expect(resumed.runtimeState.nextAgentEventSequence).toBe(9);
		expect(resumed.runtimeState.lastSummary?.trades[0]?.price.toNumber()).toBe(
			150.12,
		);
		expect(resumed.researchNotes).toHaveLength(1);
	});
});
