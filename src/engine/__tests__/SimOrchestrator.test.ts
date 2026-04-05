import { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import { describe, expect, it, vi } from "vitest";
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
import { TRADING_MODEL } from "#/mastra/models";
import type { TradingDecision } from "#/mastra/agents/trading-agent";
import type { TradingRequestContextValues } from "#/mastra/trading-context";
import type {
	AgentConfig,
	AgentState,
	AutopilotDirective,
} from "#/types/agent";
import type { ResearchNote } from "#/types/research";
import type { InjectWorldEventCommand } from "#/types/sim";

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

function makeResearchNote(id: string, publishedAtTick: number): ResearchNote {
	return {
		id,
		agentId: "research-1",
		focus: "macro",
		headline: "Fed signals a cautious path forward",
		body: "Rates may stay restrictive for longer than expected.",
		sentiment: "bearish",
		confidence: 0.78,
		symbols: ["AAPL"],
		sources: ["https://www.federalreserve.gov/newsevents.htm"],
		publishedAtTick,
		releasedToTier: "research",
	};
}

function makeConfig(
	id: string,
	overrides: Partial<AgentConfig> = {},
): AgentConfig {
	return {
		id,
		name: id,
		tier: "tier1",
		entityType: "hedge-fund",
		strategy: "value",
		persona: `${id} persona`,
		currentAgenda: `${id} agenda`,
		investmentThesis: `${id} thesis`,
		quarterlyGoal: `${id} goal`,
		personalityTraits: ["disciplined"],
		behavioralBiases: ["anchoring"],
		constraints: ["Stay within risk limits."],
		restrictedSymbols: [],
		sectors: ["Technology"],
		risk: 0.4,
		capital: 100_000,
		model: TRADING_MODEL,
		llmGroup: 0,
		decisionParams: {},
		...overrides,
	};
}

function makeState(
	config: AgentConfig,
	overrides: Partial<AgentState> = {},
): AgentState {
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
		...overrides,
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
	const config = makeConfig(id, overrides.config);
	const state = makeState(config, {
		lastAutopilotDirective: overrides.autopilotDirective ?? null,
		...overrides.state,
	});

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

function createTradingAgentDouble(
	handlers: Record<
		string,
		(
			prompt: string,
			options: Record<string, unknown>,
		) => Promise<{
			object: TradingDecision;
			chunks?: Array<{ type: string; payload?: { text?: string } }>;
		}>
	>,
) {
	let inFlight = 0;
	let maxInFlight = 0;
	const prompts: string[] = [];
	const contexts: TradingRequestContextValues[] = [];

	return {
		get maxInFlight() {
			return maxInFlight;
		},
		get prompts() {
			return prompts;
		},
		get contexts() {
			return contexts;
		},
		stream: async (prompt: string, options: Record<string, unknown>) => {
			const requestContext =
				options.requestContext as RequestContext<TradingRequestContextValues>;
			const agentId = requestContext.get("agent-id");
			if (!agentId) {
				throw new Error("Missing agent-id");
			}

			prompts.push(prompt);
			contexts.push(requestContext.all);
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);

			try {
				const result = await handlers[agentId](prompt, options);
				return {
					fullStream: (async function* () {
						for (const chunk of result.chunks ?? []) {
							yield chunk;
						}
					})(),
					object: Promise.resolve(result.object),
				};
			} finally {
				inFlight -= 1;
			}
		},
	};
}

describe("SimOrchestrator", () => {
	it("runs a full step with commands, research delivery, matching, persistence, and events", async () => {
		const registry = new AgentRegistry();
		const activeEntry = registerAgent(registry, "active-agent", {
			config: { llmGroup: 1, tier: "tier1" },
			state: {
				positions: new Map([
					[
						"AAPL",
						{
							qty: 2,
							avgCost: new Decimal("99"),
						},
					],
				]),
			},
		});
		const inactiveEntry = registerAgent(registry, "inactive-agent", {
			config: { llmGroup: 0, tier: "tier1" },
			state: {
				positions: new Map([
					[
						"AAPL",
						{
							qty: 10,
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
						price: 100,
						qty: 5,
					},
				],
				holdPositions: ["AAPL"],
			},
		});

		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);

		const publicationBus = new PublicationBus();
		const note = makeResearchNote("note-1", 1);
		publicationBus.publish(note);

		const eventBus = new EventBus();
		const tradeListener = vi.fn();
		const ohlcvListener = vi.fn();
		const signalListener = vi.fn();
		const worldEventListener = vi.fn();
		const simStateListener = vi.fn();
		eventBus.on("trade", tradeListener);
		eventBus.on("ohlcv", ohlcvListener);
		eventBus.on("agent-event", signalListener);
		eventBus.on("world-event", worldEventListener);
		eventBus.on("sim-state", simStateListener);

		const worldEventPayload: InjectWorldEventCommand = {
			eventId: "fed-cut",
			type: "macro",
			title: "Fed hints at cuts",
			magnitude: 0.4,
			affectedSymbols: ["AAPL"],
			source: "chatbot",
			payload: {
				description: "Lower rates could support multiple expansion.",
			},
		};

		const { db, state: dbState } = createDbDouble([
			{
				id: 1,
				type: "inject_world_event",
				payload: worldEventPayload,
				status: "pending",
				resultMessage: null,
				createdAt: new Date(),
				processedAt: null,
			},
			{
				id: 2,
				type: "set_speed",
				payload: { speedMultiplier: 2 },
				status: "pending",
				resultMessage: null,
				createdAt: new Date(),
				processedAt: null,
			},
			{
				id: 3,
				type: "set_tick_interval",
				payload: { tickIntervalMs: 250 },
				status: "pending",
				resultMessage: null,
				createdAt: new Date(),
				processedAt: null,
			},
			{
				id: 4,
				type: "start",
				payload: {},
				status: "pending",
				resultMessage: null,
				createdAt: new Date(),
				processedAt: null,
			},
			{
				id: 5,
				type: "bogus",
				payload: {},
				status: "pending",
				resultMessage: null,
				createdAt: new Date(),
				processedAt: null,
			},
		]);

		const tradingAgent = createTradingAgentDouble({
			"active-agent": async () => ({
				chunks: [
					{
						type: "text-delta",
						payload: { text: "AAPL looks attractive after the latest note." },
					},
				],
				object: {
					reasoning: "AAPL looks attractive after the latest note.",
					ordersPlaced: [
						{
							orderId: "llm-buy-1",
							symbol: "AAPL",
							side: "buy",
							type: "market",
							qty: 5,
							price: "0",
							status: "pending",
							filledQty: 0,
							trades: [],
						},
					],
					autopilotDirective: {
						standingOrders: [],
						holdPositions: ["AAPL"],
					},
				},
			}),
		});

		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			publicationBus,
			eventBus,
			db as never,
			tradingAgent,
			{ llmConcurrency: 2, groupCount: 2 },
		);

		const summary = await orchestrator.step();

		expect(summary.orderCount).toBe(2);
		expect(summary.tradeCount).toBe(1);
		expect(summary.activeAgents).toBe(1);
		expect(summary.simTick).toBe(1);
		expect(tradeListener).toHaveBeenCalledOnce();
		expect(ohlcvListener).toHaveBeenCalledOnce();
		expect(signalListener).toHaveBeenCalled();
		expect(worldEventListener).toHaveBeenCalledOnce();
		expect(simStateListener).toHaveBeenCalledOnce();
		expect(tradingAgent.prompts[0]).toContain(note.headline);
		expect(
			tradingAgent.contexts[0]?.["released-research-notes"]?.[0]?.headline,
		).toBe(note.headline);

		expect(activeEntry.state.researchInbox.get(note.id)?.headline).toBe(
			note.headline,
		);
		expect(inactiveEntry.state.researchInbox.get(note.id)?.headline).toBe(
			note.headline,
		);
		expect(activeEntry.state.lastLlmTick).toBe(1);
		expect(activeEntry.state.lastAutopilotDirective?.holdPositions).toEqual([
			"AAPL",
		]);
		expect(inactiveEntry.state.positions.get("AAPL")?.qty).toBe(5);
		expect(activeEntry.state.positions.get("AAPL")?.qty).toBe(7);

		expect(dbState.insertedOrders).toHaveLength(2);
		expect(dbState.insertedTrades).toHaveLength(1);
		expect(dbState.insertedTicks).toHaveLength(1);
		expect(dbState.worldEvents).toHaveLength(1);
		expect(dbState.simConfig?.speedMultiplier).toBe(2);
		expect(dbState.simConfig?.tickIntervalMs).toBe(250);
		expect(dbState.commands.map((command) => command.status)).toEqual([
			"processed",
			"processed",
			"processed",
			"processed",
			"rejected",
		]);
		expect(orchestrator.getState().isRunning).toBe(true);
		expect(orchestrator.getState().lastSummary?.tradeCount).toBe(1);
	});

	it("persists start/stop state and exposes current runtime state", async () => {
		const registry = new AgentRegistry();
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);

		const { db, state } = createDbDouble();
		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			new PublicationBus(),
			new EventBus(),
			db as never,
			createTradingAgentDouble({}),
			{ groupCount: 2 },
		);

		await orchestrator.start();
		expect(orchestrator.getState().isRunning).toBe(true);
		expect(state.simConfig?.isRunning).toBe(true);

		await orchestrator.stop();
		expect(orchestrator.getState().isRunning).toBe(false);
		expect(state.simConfig?.isRunning).toBe(false);
		expect(orchestrator.getState().activeGroupIndex).toBe(0);
	});

	it("rejects concurrent ticks", async () => {
		const registry = new AgentRegistry();
		registerAgent(registry, "active-agent", {
			config: { llmGroup: 1 },
		});
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		const { db } = createDbDouble();

		const tradingAgent = createTradingAgentDouble({
			"active-agent": async (_prompt, _options) =>
				new Promise((resolve) => {
					setTimeout(() => {
						resolve({
							object: {
								reasoning: "wait",
								ordersPlaced: [],
								autopilotDirective: {
									standingOrders: [],
									holdPositions: [],
								},
							},
						});
					}, 10);
				}),
		});

		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			new PublicationBus(),
			new EventBus(),
			db as never,
			tradingAgent,
			{ groupCount: 2 },
		);

		const firstTick = orchestrator.tick();
		await expect(orchestrator.tick()).rejects.toThrow(
			"SimOrchestrator is already processing a tick",
		);
		await firstTick;
	});

	it("falls back to hold/no-order when an active LLM turn times out", async () => {
		const registry = new AgentRegistry();
		const entry = registerAgent(registry, "active-agent", {
			config: { llmGroup: 1 },
			state: {
				positions: new Map([
					[
						"AAPL",
						{
							qty: 3,
							avgCost: new Decimal("98"),
						},
					],
				]),
			},
		});
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		const { db, state } = createDbDouble();
		const eventBus = new EventBus();
		const agentEventListener = vi.fn();
		eventBus.on("agent-event", agentEventListener);
		const tradingAgent = createTradingAgentDouble({
			"active-agent": async (_prompt, _options) =>
				new Promise((_, reject) => {
					const signal = _options.abortSignal as AbortSignal;
					signal.addEventListener("abort", () => {
						reject(new Error("aborted"));
					});
				}),
		});

		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			new PublicationBus(),
			eventBus,
			db as never,
			tradingAgent,
			{ llmTimeoutMs: 5, groupCount: 2 },
		);

		const summary = await orchestrator.step();

		expect(summary.orderCount).toBe(0);
		expect(summary.tradeCount).toBe(0);
		expect(entry.state.lastAutopilotDirective?.holdPositions).toEqual(["AAPL"]);
		expect(state.insertedOrders).toEqual([]);
		expect(agentEventListener).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "failed",
				reason: "timeout",
				agentId: "active-agent",
			}),
		);
	});

	it("emits a schema failure event and applies the fallback directive", async () => {
		const registry = new AgentRegistry();
		const entry = registerAgent(registry, "active-agent", {
			config: { llmGroup: 1 },
			state: {
				positions: new Map([
					[
						"AAPL",
						{
							qty: 2,
							avgCost: new Decimal("101"),
						},
					],
				]),
			},
		});
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		const { db, state } = createDbDouble();
		const eventBus = new EventBus();
		const agentEvents: Array<Record<string, unknown>> = [];
		eventBus.on("agent-event", (event) => {
			agentEvents.push(event as unknown as Record<string, unknown>);
		});

		const tradingAgent = createTradingAgentDouble({
			"active-agent": async () => ({
				object: {
					reasoning: "timeout",
					ordersPlaced: [],
					autopilotDirective: {
						standingOrders: [],
						holdPositions: [],
					},
				},
			}),
		});

		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			new PublicationBus(),
			eventBus,
			db as never,
			tradingAgent,
			{ groupCount: 2 },
		);

		const summary = await orchestrator.step();

		expect(summary.orderCount).toBe(0);
		expect(state.insertedOrders).toEqual([]);
		expect(entry.state.lastAutopilotDirective?.holdPositions).toEqual(["AAPL"]);
		expect(agentEvents).toContainEqual(
			expect.objectContaining({
				type: "failed",
				reason: "schema_validation_failed",
				agentId: "active-agent",
			}),
		);
	});

	it("processes step commands without resuming the simulation", async () => {
		const registry = new AgentRegistry();
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		const { db, state } = createDbDouble([
			{
				id: 1,
				type: "step",
				payload: {},
				status: "pending",
				resultMessage: null,
				createdAt: new Date(),
				processedAt: null,
			},
			{
				id: 2,
				type: "set_speed",
				payload: { speedMultiplier: 3 },
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
			new PublicationBus(),
			new EventBus(),
			db as never,
			createTradingAgentDouble({}),
			{ groupCount: 2 },
		);

		const outcome = await orchestrator.processControlCommands();

		expect(outcome).toEqual({ processed: true, stepCount: 1 });
		expect(orchestrator.getState().isRunning).toBe(false);
		expect(state.commands.map((command) => command.status)).toEqual([
			"processed",
			"processed",
		]);
		expect(state.simConfig?.speedMultiplier).toBe(3);
	});

	it("honors the configured LLM concurrency limit", async () => {
		const registry = new AgentRegistry();
		registerAgent(registry, "active-1", { config: { llmGroup: 1 } });
		registerAgent(registry, "active-2", { config: { llmGroup: 1 } });
		registerAgent(registry, "active-3", { config: { llmGroup: 1 } });
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		const { db } = createDbDouble();

		const tradingAgent = createTradingAgentDouble({
			"active-1": async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				return {
					object: {
						reasoning: "wait",
						ordersPlaced: [],
						autopilotDirective: {
							standingOrders: [],
							holdPositions: [],
						},
					},
				};
			},
			"active-2": async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				return {
					object: {
						reasoning: "wait",
						ordersPlaced: [],
						autopilotDirective: {
							standingOrders: [],
							holdPositions: [],
						},
					},
				};
			},
			"active-3": async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
				return {
					object: {
						reasoning: "wait",
						ordersPlaced: [],
						autopilotDirective: {
							standingOrders: [],
							holdPositions: [],
						},
					},
				};
			},
		});

		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			new PublicationBus(),
			new EventBus(),
			db as never,
			tradingAgent,
			{ llmConcurrency: 1, groupCount: 2 },
		);

		await orchestrator.step();

		expect(tradingAgent.maxInFlight).toBe(1);
	});

	it("ignores already processed commands and does not duplicate research delivery on later ticks", async () => {
		const registry = new AgentRegistry();
		const entry = registerAgent(registry, "active-agent", {
			config: { llmGroup: 1, tier: "tier1" },
		});
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		const publicationBus = new PublicationBus();
		publicationBus.publish(makeResearchNote("note-1", 1));
		const { db, state } = createDbDouble([
			{
				id: 1,
				type: "pause",
				payload: {},
				status: "processed",
				resultMessage: "done",
				createdAt: new Date(),
				processedAt: new Date(),
			},
		]);
		const tradingAgent = createTradingAgentDouble({
			"active-agent": async () => ({
				object: {
					reasoning: "wait",
					ordersPlaced: [],
					autopilotDirective: {
						standingOrders: [],
						holdPositions: [],
					},
				},
			}),
		});
		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			publicationBus,
			new EventBus(),
			db as never,
			tradingAgent,
			{ groupCount: 2 },
		);

		await orchestrator.step();
		const inboxSizeAfterFirstTick = entry.state.researchInbox.size;
		await orchestrator.step();

		expect(state.commands[0]?.status).toBe("processed");
		expect(entry.state.researchInbox.size).toBe(inboxSizeAfterFirstTick);
	});

	it("rejects unsupported symbols without crashing the tick", async () => {
		const registry = new AgentRegistry();
		const inactiveEntry = registerAgent(registry, "inactive-agent", {
			config: { llmGroup: 0 },
			autopilotDirective: {
				standingOrders: [
					{
						symbol: "XOM",
						side: "buy",
						type: "limit",
						price: 149.9,
						qty: 5,
					},
				],
				holdPositions: [],
			},
		});
		registerAgent(registry, "active-agent", {
			config: { llmGroup: 1 },
		});
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		const { db, state } = createDbDouble();
		const tradingAgent = createTradingAgentDouble({
			"active-agent": async () => ({
				object: {
					reasoning: "wait",
					ordersPlaced: [],
					autopilotDirective: {
						standingOrders: [],
						holdPositions: [],
					},
				},
			}),
		});
		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			new PublicationBus(),
			new EventBus(),
			db as never,
			tradingAgent,
			{ groupCount: 2 },
		);

		const summary = await orchestrator.step();

		expect(summary.orderCount).toBe(1);
		expect(summary.tradeCount).toBe(0);
		expect(state.insertedOrders).toHaveLength(1);
		expect(state.insertedOrders[0]?.symbol).toBe("XOM");
		expect(state.insertedOrders[0]?.status).toBe("cancelled");
		expect(inactiveEntry.state.openOrders.size).toBe(0);
	});

	it("replays duplicate open order ids safely without re-matching", async () => {
		const registry = new AgentRegistry();
		const entry = registerAgent(registry, "active-agent", {
			config: { llmGroup: 0 },
		});
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		const { db, state } = createDbDouble();
		const tradingAgent = createTradingAgentDouble({
			"active-agent": async () => ({
				object: {
					reasoning: "Keep the resting bid in place.",
					ordersPlaced: [
						{
							orderId: "repeat-order",
							symbol: "AAPL",
							side: "buy",
							type: "limit",
							qty: 5,
							price: "149.95",
							status: "pending",
							filledQty: 0,
							trades: [],
						},
					],
					autopilotDirective: {
						standingOrders: [],
						holdPositions: ["AAPL"],
					},
				},
			}),
		});
		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			new PublicationBus(),
			new EventBus(),
			db as never,
			tradingAgent,
			{ groupCount: 1 },
		);

		const firstSummary = await orchestrator.step();
		const secondSummary = await orchestrator.step();

		expect(firstSummary.orderCount).toBe(1);
		expect(secondSummary.orderCount).toBe(1);
		expect(entry.state.openOrders.size).toBe(1);
		expect(entry.state.openOrders.has("repeat-order")).toBe(true);
		expect(state.insertedOrders).toHaveLength(2);
		expect(state.insertedOrders[0]?.id).toBe("repeat-order");
		expect(state.insertedOrders[1]?.id).toBe("repeat-order");
	});

	it("propagates persistence failures instead of reporting a successful tick", async () => {
		const registry = new AgentRegistry();
		registerAgent(registry, "active-agent", {
			config: { llmGroup: 1 },
		});
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		const { db } = createDbDouble();
		db.transaction = async () => {
			throw new Error("db write failed");
		};
		const tradingAgent = createTradingAgentDouble({
			"active-agent": async () => ({
				object: {
					reasoning: "wait",
					ordersPlaced: [],
					autopilotDirective: {
						standingOrders: [],
						holdPositions: [],
					},
				},
			}),
		});
		const orchestrator = new SimOrchestrator(
			engine,
			registry,
			new SimClock(5),
			new PublicationBus(),
			new EventBus(),
			db as never,
			tradingAgent,
			{ groupCount: 2 },
		);

		await expect(orchestrator.step()).rejects.toThrow("db write failed");
		expect(orchestrator.getState().lastSummary).toBeNull();
	});
});
