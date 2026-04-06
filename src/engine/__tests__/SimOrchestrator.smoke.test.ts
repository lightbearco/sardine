import { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { AgentRegistry } from "#/agents/AgentRegistry";
import {
	agents as agentsTable,
	commands as commandsTable,
	orders as ordersTable,
	simConfig as simConfigTable,
	ticks as ticksTable,
	trades as tradesTable,
	worldEvents as worldEventsTable,
} from "#/db/schema";
import { EventBus } from "#/engine/bus/EventBus";
import { PublicationBus } from "#/engine/bus/PublicationBus";
import { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SimClock } from "#/engine/sim/SimClock";
import { SimOrchestrator } from "#/engine/sim/SimOrchestrator";
import { tradingAgent } from "#/mastra/agents/trading-agent";
import { hasGoogleGenerativeAIEnv } from "#/mastra/google-gemini";
import { TRADING_MODEL } from "#/mastra/models";
import type { TradingRequestContextValues } from "#/mastra/trading-context";
import type {
	AgentConfig,
	AgentState,
	AutopilotDirective,
} from "#/types/agent";
import type { ResearchNote } from "#/types/research";

type CommandStatus = "pending" | "processed" | "rejected";

interface FakeCommandRow {
	id: number;
	type: string;
	payload: unknown;
	status: CommandStatus;
	resultMessage: string | null;
	createdAt: Date | null;
	processedAt: Date | null;
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		id: "live-agent-1",
		name: "Live Agent 1",
		tier: "tier1",
		entityType: "hedge-fund",
		strategy: "value",
		persona:
			"You are a pragmatic portfolio manager looking for high-conviction dislocations.",
		currentAgenda:
			"Exploit obvious short-term mispricings while respecting risk.",
		investmentThesis:
			"Large-cap tech should mean revert after outsized intraday sentiment swings.",
		quarterlyGoal: "Grow capital steadily without oversized drawdowns.",
		personalityTraits: ["disciplined", "opportunistic"],
		behavioralBiases: ["anchoring"],
		constraints: ["Use small size when confidence is low."],
		restrictedSymbols: [],
		sectors: ["Technology"],
		risk: 0.45,
		capital: 100_000,
		model: TRADING_MODEL,
		llmGroup: 1,
		decisionParams: {},
		...overrides,
	};
}

function makeState(config: AgentConfig): AgentState {
	return {
		id: config.id,
		name: config.name,
		tier: config.tier,
		status: "active",
		strategy: config.strategy,
		llmGroup: config.llmGroup,
		cash: new Decimal(config.capital),
		nav: new Decimal(config.capital),
		positions: new Map(),
		openOrders: new Map(),
		researchInbox: new Map(),
		lastAutopilotDirective: null,
		lastLlmTick: null,
		realizedPnl: new Map(),
		pendingFills: [],
	};
}

function makeResearchNote(id: string, publishedAtTick: number): ResearchNote {
	return {
		id,
		agentId: "research-agent-1",
		focus: "macro",
		headline: "Rates likely stay higher for longer",
		body: "A hawkish hold could pressure multiples near term.",
		sentiment: "bearish",
		confidence: 0.74,
		symbols: ["AAPL"],
		sources: ["https://example.com/macro"],
		publishedAtTick,
		releasedToTier: "research",
	};
}

function makeRequestContext(config: AgentConfig) {
	const requestContext = new RequestContext<TradingRequestContextValues>();
	requestContext.set("agent-id", config.id);
	requestContext.set("agent-name", config.name);
	requestContext.set("entity-type", config.entityType);
	requestContext.set("tier", config.tier);
	requestContext.set("strategy", config.strategy);
	requestContext.set("persona", config.persona);
	requestContext.set("current-agenda", config.currentAgenda);
	requestContext.set("investment-thesis", config.investmentThesis);
	requestContext.set("quarterly-goal", config.quarterlyGoal);
	requestContext.set("personality-traits", [...config.personalityTraits]);
	requestContext.set("behavioral-biases", [...config.behavioralBiases]);
	requestContext.set("constraints", [...config.constraints]);
	requestContext.set("mandate-sectors", [...config.sectors]);
	requestContext.set("risk-tolerance", config.risk);
	requestContext.set("capital", config.capital);
	requestContext.set("model", config.model);
	requestContext.set("model-tier", "haiku");
	requestContext.set("llm-group", config.llmGroup);
	requestContext.set("decision-params", { ...config.decisionParams });
	requestContext.set("restricted-symbols", [...config.restrictedSymbols]);
	return requestContext;
}

function registerAgent(
	registry: AgentRegistry,
	id: string,
	overrides: {
		config?: Partial<AgentConfig>;
		state?: Partial<AgentState>;
		autopilotDirective?: AutopilotDirective | null;
	} = {},
) {
	const config = makeConfig({
		id,
		name: id,
		...overrides.config,
	});
	const state = {
		...makeState(config),
		...overrides.state,
		lastAutopilotDirective: overrides.autopilotDirective ?? null,
	};

	registry.register({
		config,
		state,
		requestContext: makeRequestContext(config),
	});

	return registry.get(id)!;
}

function createDbDouble(initialCommands: FakeCommandRow[] = []) {
	const state = {
		commands: [...initialCommands],
		insertedOrders: [] as Record<string, unknown>[],
		insertedTrades: [] as Record<string, unknown>[],
		insertedTicks: [] as Record<string, unknown>[],
		upsertedAgents: [] as Record<string, unknown>[],
		worldEvents: [] as Record<string, unknown>[],
		simConfig: null as Record<string, unknown> | null,
	};

	const applyInsert = (
		table: unknown,
		values: Record<string, unknown> | Record<string, unknown>[],
	) => {
		const rows = Array.isArray(values) ? values : [values];
		if (table === ordersTable) {
			state.insertedOrders.push(...rows);
		} else if (table === tradesTable) {
			state.insertedTrades.push(...rows);
		} else if (table === ticksTable) {
			state.insertedTicks.push(...rows);
		}
		return rows;
	};

	const insert = (table: unknown) => ({
		values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
			const rows = applyInsert(table, values);
			return {
				onConflictDoUpdate: async ({
					set,
				}: {
					set: Record<string, unknown>;
				}) => {
					if (table === agentsTable) {
						state.upsertedAgents.push(
							...rows.map((row) => ({ ...row, ...set })),
						);
					} else if (table === worldEventsTable) {
						state.worldEvents.push(...rows.map((row) => ({ ...row, ...set })));
					} else if (table === simConfigTable) {
						state.simConfig = { ...rows[0], ...set };
					}
				},
			};
		},
	});

	const update = (table: unknown) => ({
		set: (values: Partial<FakeCommandRow>) => ({
			where: async () => {
				if (table !== commandsTable) {
					return;
				}

				const command = state.commands.find(
					(entry) => entry.status === "pending",
				);
				if (!command) {
					return;
				}

				Object.assign(command, values);
			},
		}),
	});

	const select = () => ({
		from: (table: unknown) => ({
			where: () => ({
				orderBy: async () =>
					table === commandsTable
						? state.commands
								.filter((command) => command.status === "pending")
								.sort((left, right) => left.id - right.id)
						: [],
			}),
		}),
	});

	const tx = { insert, update };
	const db = {
		select,
		insert,
		update,
		transaction: async (
			callback: (transaction: typeof tx) => Promise<unknown>,
		) => callback(tx),
	};

	return { db, state };
}

const hasLiveGoogleCredentials =
	process.env.RUN_LIVE_GEMINI_SMOKE === "true" && hasGoogleGenerativeAIEnv();

describe("SimOrchestrator smoke", () => {
	it.skipIf(!hasLiveGoogleCredentials)(
		"runs one mixed tick with live Gemini, autopilot, research delivery, and command handling",
		async () => {
			const registry = new AgentRegistry();
			const activeEntry = registerAgent(registry, "live-agent-1", {
				config: {
					llmGroup: 0,
					model: TRADING_MODEL,
				},
			});
			const inactiveEntry = registerAgent(registry, "inactive-autopilot-1", {
				config: {
					llmGroup: 1,
					model: TRADING_MODEL,
				},
				state: {
					positions: new Map([
						[
							"AAPL",
							{
								qty: 8,
								avgCost: new Decimal("100"),
							},
						],
					]),
				},
				autopilotDirective: {
					standingOrders: [
						{
							symbol: "AAPL",
							side: "sell",
							type: "limit",
							price: 105,
							qty: 3,
						},
					],
					holdPositions: ["AAPL"],
				},
			});

			registerAgent(registry, "market-maker-seed");

			const engine = new MatchingEngine();
			engine.initialize(["AAPL"]);
			engine.seedBook("AAPL", new Decimal(100), new Decimal("0.10"), 3, 50, 0);

			const publicationBus = new PublicationBus();
			const releasedNote = makeResearchNote("macro-note-1", 1);
			publicationBus.publish(releasedNote);

			const eventBus = new EventBus();
			const agentEvents: Array<Record<string, unknown>> = [];
			const worldEvents: Array<Record<string, unknown>> = [];
			eventBus.on("agent-event", (event) => {
				agentEvents.push(event as unknown as Record<string, unknown>);
			});
			eventBus.on("world-event", (event) => {
				worldEvents.push(event as unknown as Record<string, unknown>);
			});

			const { db, state: dbState } = createDbDouble([
				{
					id: 1,
					type: "inject_world_event",
					payload: {
						eventId: "live-fed-event",
						type: "macro",
						title: "Fed stays hawkish",
						magnitude: -0.35,
						affectedSymbols: ["AAPL"],
						source: "chatbot",
						payload: {
							description:
								"Higher-for-longer rhetoric pressures valuation multiples.",
						},
					},
					status: "pending",
					resultMessage: null,
					createdAt: new Date(),
					processedAt: null,
				},
				{
					id: 2,
					type: "set_speed",
					payload: { speedMultiplier: 1.5 },
					status: "pending",
					resultMessage: null,
					createdAt: new Date(),
					processedAt: null,
				},
				{
					id: 3,
					type: "set_tick_interval",
					payload: { tickIntervalMs: 200 },
					status: "pending",
					resultMessage: null,
					createdAt: new Date(),
					processedAt: null,
				},
				{
					id: 4,
					type: "bogus",
					payload: {},
					status: "pending",
					resultMessage: null,
					createdAt: new Date(),
					processedAt: null,
				},
			]);
			const orchestrator = new SimOrchestrator(
				engine,
				registry,
				new SimClock(5),
				publicationBus,
				eventBus,
				db as never,
				tradingAgent,
				{ groupCount: 1, llmTimeoutMs: 30_000 },
			);

			const summary = await orchestrator.step();
			const lastDirective = registry.get(activeEntry.config.id)?.state
				.lastAutopilotDirective;

			console.log("\n[live-orchestrator] Tick summary:");
			console.log(JSON.stringify(summary, null, 2));
			console.log("\n[live-orchestrator] Last autopilot directive:");
			console.log(JSON.stringify(lastDirective, null, 2));
			console.log("\n[live-orchestrator] Signal events:");
			console.log(JSON.stringify(agentEvents, null, 2));

			expect(summary.activeAgents).toBe(1);
			expect(summary.simTick).toBe(1);
			expect(summary.orderCount).toBeGreaterThanOrEqual(1);
			expect(registry.get(activeEntry.config.id)?.state.lastLlmTick).toBe(1);
			expect(lastDirective).not.toBeNull();
			expect(lastDirective?.holdPositions).toBeDefined();
			expect(
				registry
					.get(activeEntry.config.id)
					?.state.researchInbox.has("macro-note-1"),
			).toBe(true);
			expect(
				registry
					.get(inactiveEntry.config.id)
					?.state.researchInbox.has("macro-note-1"),
			).toBe(true);
			expect(dbState.simConfig).not.toBeNull();
			expect(dbState.upsertedAgents.length).toBeGreaterThan(0);
			expect(
				dbState.commands.some((command) => command.status === "rejected"),
			).toBe(true);
			expect(worldEvents).toHaveLength(1);
			expect(worldEvents[0]?.eventId ?? worldEvents[0]?.id).toBe(
				"live-fed-event",
			);

			if (summary.orderCount > 0) {
				expect(dbState.insertedOrders.length).toBe(summary.orderCount);
			}

			if (summary.tradeCount > 0) {
				expect(dbState.insertedTrades.length).toBe(summary.tradeCount);
			}
		},
		90_000,
	);

	it.skipIf(!hasLiveGoogleCredentials)(
		"keeps research delivery idempotent across repeated live ticks and leaves processed commands untouched",
		async () => {
			const registry = new AgentRegistry();
			const activeEntry = registerAgent(registry, "live-agent-repeat", {
				config: {
					llmGroup: 0,
					model: TRADING_MODEL,
				},
			});
			registerAgent(registry, "market-maker-seed");
			const engine = new MatchingEngine();
			engine.initialize(["AAPL"]);
			engine.seedBook("AAPL", new Decimal(100), new Decimal("0.10"), 3, 50, 0);

			const publicationBus = new PublicationBus();
			publicationBus.publish(makeResearchNote("repeat-note-1", 1));

			const { db, state: dbState } = createDbDouble([
				{
					id: 1,
					type: "start",
					payload: {},
					status: "pending",
					resultMessage: null,
					createdAt: new Date(),
					processedAt: null,
				},
				{
					id: 2,
					type: "pause",
					payload: {},
					status: "processed",
					resultMessage: "already handled",
					createdAt: new Date(),
					processedAt: new Date(),
				},
			]);
			const eventBus = new EventBus();
			const orchestrator = new SimOrchestrator(
				engine,
				registry,
				new SimClock(5),
				publicationBus,
				eventBus,
				db as never,
				tradingAgent,
				{ groupCount: 1, llmTimeoutMs: 30_000 },
			);

			const firstSummary = await orchestrator.step();
			const inboxSizeAfterFirstTick =
				registry.get(activeEntry.config.id)?.state.researchInbox.size ?? 0;
			const processedCommandsAfterFirstTick = dbState.commands.map(
				(command) => command.status,
			);
			const secondSummary = await orchestrator.step();
			const inboxSizeAfterSecondTick =
				registry.get(activeEntry.config.id)?.state.researchInbox.size ?? 0;

			console.log("\n[live-orchestrator-repeat] First summary:");
			console.log(JSON.stringify(firstSummary, null, 2));
			console.log("\n[live-orchestrator-repeat] Second summary:");
			console.log(JSON.stringify(secondSummary, null, 2));

			expect(firstSummary.simTick).toBe(1);
			expect(secondSummary.simTick).toBe(2);
			expect(firstSummary.activeAgents).toBe(1);
			expect(secondSummary.activeAgents).toBe(1);
			expect(inboxSizeAfterFirstTick).toBeGreaterThan(0);
			expect(inboxSizeAfterSecondTick).toBe(inboxSizeAfterFirstTick);
			expect(processedCommandsAfterFirstTick).toEqual([
				"processed",
				"processed",
			]);
			expect(dbState.commands.map((command) => command.status)).toEqual([
				"processed",
				"processed",
			]);
			expect(orchestrator.getState().lastSummary?.simTick).toBe(2);
			expect(activeEntry.state.lastLlmTick).toBe(2);
		},
		120_000,
	);

	it.skipIf(!hasLiveGoogleCredentials)(
		"falls back cleanly when a live Gemini turn times out",
		async () => {
			const registry = new AgentRegistry();
			const activeEntry = registerAgent(registry, "live-agent-timeout", {
				config: {
					llmGroup: 0,
					model: TRADING_MODEL,
				},
				state: {
					positions: new Map([
						[
							"AAPL",
							{
								qty: 4,
								avgCost: new Decimal("99"),
							},
						],
					]),
				},
			});
			registerAgent(registry, "market-maker-seed");
			const engine = new MatchingEngine();
			engine.initialize(["AAPL"]);
			engine.seedBook("AAPL", new Decimal(100), new Decimal("0.10"), 3, 50, 0);

			const { db, state: dbState } = createDbDouble();
			const orchestrator = new SimOrchestrator(
				engine,
				registry,
				new SimClock(5),
				new PublicationBus(),
				new EventBus(),
				db as never,
				tradingAgent,
				{ groupCount: 1, llmTimeoutMs: 1 },
			);

			const summary = await orchestrator.step();
			const fallbackDirective = activeEntry.state.lastAutopilotDirective;

			console.log("\n[live-orchestrator-timeout] Timeout summary:");
			console.log(JSON.stringify(summary, null, 2));
			console.log("\n[live-orchestrator-timeout] Fallback directive:");
			console.log(JSON.stringify(fallbackDirective, null, 2));

			expect(summary.simTick).toBe(1);
			expect(summary.orderCount).toBe(0);
			expect(summary.tradeCount).toBe(0);
			expect(fallbackDirective).not.toBeNull();
			expect(fallbackDirective?.standingOrders).toEqual([]);
			expect(fallbackDirective?.holdPositions).toEqual(["AAPL"]);
			expect(activeEntry.state.lastLlmTick).toBe(1);
			expect(dbState.insertedOrders).toHaveLength(0);
			expect(dbState.insertedTrades).toHaveLength(0);
			expect(dbState.simConfig).not.toBeNull();
		},
		30_000,
	);
});
