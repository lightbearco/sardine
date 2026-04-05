import { pathToFileURL } from "node:url";
import { and, asc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import {
	bootstrapSimulation,
	restoreSimulation,
	type ResearchAgentWorker,
} from "#/agents/bootstrap";
import {
	createAlpacaClient,
	hasAlpacaEnv,
	type AlpacaClient,
} from "#/alpaca/client";
import { loadBootstrapMarketData } from "#/alpaca/live-feed";
import { db } from "#/db/index";
import {
	agentEvents as agentEventsTable,
	agents as agentsTable,
	divergenceLog as divergenceLogTable,
	orders as ordersTable,
	researchNotes as researchNotesTable,
	simConfig as simConfigTable,
} from "#/db/schema";
import { EventBus } from "#/engine/bus/EventBus";
import { PublicationBus } from "#/engine/bus/PublicationBus";
import { SimClock } from "#/engine/sim/SimClock";
import { SimOrchestrator } from "#/engine/sim/SimOrchestrator";
import { DEV_TICKERS, SIM_DEFAULTS } from "#/lib/constants";
import { buildDefaultTraderDistribution } from "#/lib/simulation-session";
import { researchAgent, researchCycleResultSchema } from "#/mastra/agents/research-agent";
import { cloneResearchRequestContext } from "#/mastra/research-context";
import { tradingAgent } from "#/mastra/agents/trading-agent";
import type { AutopilotDirective } from "#/types/agent";
import type { ResearchFocus } from "#/types/research";
import type { TickSummary } from "#/types/sim";
import {
	listRunnableSimulationSessions,
	markSimulationSessionActive,
	markSimulationSessionFailed,
} from "#/server/sessions";
import { broadcaster } from "./ws/broadcaster";
import { startSimWebSocketServer } from "./ws/SimWebSocketServer";

type ResearchAgentLike = {
	generate(
		prompt: string,
		options: Record<string, unknown>,
	): Promise<{
		object: unknown;
	}>;
};

type SimulationRuntime = {
	sessionId: string;
	symbols: string[];
	alpacaClient: AlpacaClient | null;
	eventBus: EventBus;
	publicationBus: PublicationBus;
	researchWorkers: ResearchAgentWorker[];
	orchestrator: SimOrchestrator;
	nextTickAtMs: number;
};

type RunnableSimulationSession =
	Awaited<ReturnType<typeof listRunnableSimulationSessions>>[number];
type PersistedSimConfigRow = typeof simConfigTable.$inferSelect;
type PersistedAgentRow = typeof agentsTable.$inferSelect;
type PersistedOpenOrderRow = typeof ordersTable.$inferSelect;
type PersistedResearchNoteRow = typeof researchNotesTable.$inferSelect;

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

type BroadcastChannel = "ohlcv" | "lob" | "trades" | "agents";

type BroadcastCounters = Record<BroadcastChannel, number>;

const shouldLogWebsocketStats = process.env.SIM_WS_VERBOSE_LOGS === "1";
const broadcastCounters = new Map<string, BroadcastCounters>();

function createBroadcastCounters(): BroadcastCounters {
	return {
		ohlcv: 0,
		lob: 0,
		trades: 0,
		agents: 0,
	};
}

function ensureBroadcastCounters(sessionId: string): BroadcastCounters {
	if (!broadcastCounters.has(sessionId)) {
		broadcastCounters.set(sessionId, createBroadcastCounters());
	}
	return broadcastCounters.get(sessionId)!;
}

function resetBroadcastCounters(sessionId: string) {
	broadcastCounters.set(sessionId, createBroadcastCounters());
}

function trackBroadcast(sessionId: string, channel: BroadcastChannel) {
	const counters = ensureBroadcastCounters(sessionId);
	counters[channel] += 1;
}

function logBroadcastCounters(sessionId: string) {
	if (!shouldLogWebsocketStats) {
		return;
	}

	const counters = broadcastCounters.get(sessionId);
	if (!counters) {
		return;
	}

	const { ohlcv, lob, trades, agents } = counters;
	console.log(
		`[SimRunner] ${sessionId} websocket events this tick: ohlcv=${ohlcv} lob=${lob} trades=${trades} agents=${agents}`,
	);

	broadcastCounters.set(sessionId, createBroadcastCounters());
}

function wireRuntimeBroadcasts(sessionId: string, eventBus: EventBus): void {
	resetBroadcastCounters(sessionId);
	eventBus.on("ohlcv", (bar) => {
		broadcaster.broadcast(`ohlcv:${sessionId}:${bar.symbol}`, bar);
		trackBroadcast(sessionId, "ohlcv");
	});

	eventBus.on("lob-update", (snapshot) => {
		broadcaster.broadcast(`lob:${sessionId}:${snapshot.symbol}`, snapshot);
		trackBroadcast(sessionId, "lob");
	});

	eventBus.on("trade", (trade) => {
		broadcaster.broadcast(`trades:${sessionId}:${trade.symbol}`, [trade]);
		trackBroadcast(sessionId, "trades");
	});

	eventBus.on("agent-event", (event) => {
		broadcaster.broadcast(`agents:${sessionId}`, event);
		trackBroadcast(sessionId, "agents");
	});

	eventBus.on("research-published", (note) => {
		broadcaster.broadcast(`research:${sessionId}`, note);
	});

	eventBus.on("sim-state", (state) => {
		broadcaster.broadcast(`sim:${sessionId}`, state);
	});
}

async function createBootstrapMarketData(symbols: string[]): Promise<{
	alpacaClient: AlpacaClient | null;
	marketData: Awaited<ReturnType<typeof loadBootstrapMarketData>> | null;
}> {
	if (!hasAlpacaEnv()) {
		return {
			alpacaClient: null,
			marketData: null,
		};
	}

	const alpacaClient = createAlpacaClient();

	try {
		return {
			alpacaClient,
			marketData: await loadBootstrapMarketData(symbols, alpacaClient),
		};
	} catch (error) {
		console.warn(
			"[SimRunner] Alpaca bootstrap failed; falling back to local seed prices.",
			error,
		);
		return {
			alpacaClient,
			marketData: null,
		};
	}
}

function resolveSessionRuntimeConfig(session: RunnableSimulationSession): {
	symbols: string[];
	agentCount: number;
	groupCount: number;
	tickIntervalMs: number;
	simulatedTickDuration: number;
	traderDistribution: ReturnType<typeof buildDefaultTraderDistribution>;
} {
	const symbols =
		session.symbols.length > 0
			? session.symbols
			: DEV_TICKERS.map((ticker) => ticker.symbol);
	const agentCount = session.agentCount ?? SIM_DEFAULTS.agentCount;

	return {
		symbols,
		agentCount,
		groupCount: Math.min(
			session.groupCount ?? SIM_DEFAULTS.groupCount,
			agentCount,
		),
		tickIntervalMs: session.tickIntervalMs ?? SIM_DEFAULTS.tickIntervalMs,
		simulatedTickDuration:
			session.simulatedTickDuration ?? SIM_DEFAULTS.simulatedTickDuration,
		traderDistribution:
			session.traderDistribution ??
			buildDefaultTraderDistribution(agentCount),
	};
}

function toResearchNote(row: PersistedResearchNoteRow) {
	return {
		id: row.noteId,
		agentId: row.agentId,
		focus: row.focus as ResearchFocus,
		headline: row.headline,
		body: row.body,
		sentiment: row.sentiment,
		confidence: row.confidence,
		symbols: row.symbols ?? [],
		sources: row.sources ?? [],
		publishedAtTick: row.publishedAtTick,
		releasedToTier: row.releasedToTier,
	};
}

function logRuntimeEvent(sessionId: string, message: string): void {
	console.log(`[SimRunner] ${sessionId} ${message}`);
}

function logTickSummary(sessionId: string, summary: TickSummary): void {
	console.log(
		`[SimRunner] ${sessionId} tick=${summary.simTick} durationMs=${summary.durationMs} trades=${summary.tradeCount} orders=${summary.orderCount} running=${summary.isRunning}`,
	);
	logBroadcastCounters(sessionId);
}

async function loadPersistedSessionState(sessionId: string): Promise<{
	simConfig: PersistedSimConfigRow;
	agents: PersistedAgentRow[];
	openOrders: PersistedOpenOrderRow[];
	researchNotes: PersistedResearchNoteRow[];
	agentEventCount: number;
}> {
	const [simConfigRows, agentRows, openOrderRows, researchNoteRows, agentEventRows] =
		await Promise.all([
			db.select().from(simConfigTable).where(eq(simConfigTable.sessionId, sessionId)).limit(1),
			db.select().from(agentsTable).where(eq(agentsTable.sessionId, sessionId)),
			db
				.select()
				.from(ordersTable)
				.where(
					and(
						eq(ordersTable.sessionId, sessionId),
						inArray(ordersTable.status, ["pending", "open", "partial"]),
					),
				)
				.orderBy(asc(ordersTable.tick), asc(ordersTable.createdAt)),
			db
				.select()
				.from(researchNotesTable)
				.where(eq(researchNotesTable.sessionId, sessionId))
				.orderBy(asc(researchNotesTable.publishedAtTick), asc(researchNotesTable.createdAt)),
			db
				.select({ eventId: agentEventsTable.eventId })
				.from(agentEventsTable)
				.where(eq(agentEventsTable.sessionId, sessionId)),
		]);

	const simConfig = simConfigRows[0];
	if (!simConfig) {
		throw new Error(`Missing sim_config row for active session ${sessionId}`);
	}

	return {
		simConfig,
		agents: agentRows,
		openOrders: openOrderRows,
		researchNotes: researchNoteRows,
		agentEventCount: agentEventRows.length,
	};
}

async function bootstrapSimulationRuntime(
	session: RunnableSimulationSession,
): Promise<SimulationRuntime> {
	const sessionId = session.id;
	const {
		symbols,
		agentCount,
		groupCount,
		tickIntervalMs,
		simulatedTickDuration,
		traderDistribution,
	} = resolveSessionRuntimeConfig(session);
	const { alpacaClient, marketData } = await createBootstrapMarketData(symbols);
	const bootstrap = await bootstrapSimulation({
		sessionId,
		symbols,
		seed: session.seed,
		agentCount,
		groupCount,
		tickIntervalMs,
		simulatedTickDuration,
		traderDistribution,
		marketData,
	});

	const eventBus = new EventBus();
	const publicationBus = new PublicationBus();
	const simClock = new SimClock(
		simulatedTickDuration,
		{
			initialTick: bootstrap.initialTick,
		},
	);
	const orchestrator = new SimOrchestrator(
		bootstrap.matchingEngine,
		bootstrap.agentRegistry,
		simClock,
		publicationBus,
		eventBus,
		db,
		tradingAgent,
		{
			groupCount,
			sessionId,
			tickIntervalMs,
		},
	);

	wireRuntimeBroadcasts(sessionId, eventBus);
	await markSimulationSessionActive(sessionId);
	await orchestrator.start();
	broadcaster.broadcast(`sim:${sessionId}`, orchestrator.getRuntimeState());

	logRuntimeEvent(
		sessionId,
		`bootstrapped agents=${bootstrap.agentRegistry.getAll().length} initialTick=${bootstrap.initialTick}`,
	);

	return {
		sessionId,
		symbols,
		alpacaClient,
		eventBus,
		publicationBus,
		researchWorkers: bootstrap.researchWorkers,
		orchestrator,
		nextTickAtMs: Date.now(),
	};
}

async function resumeSimulationRuntime(
	session: RunnableSimulationSession,
): Promise<SimulationRuntime> {
	const sessionId = session.id;
	const {
		symbols,
		agentCount,
		groupCount,
		tickIntervalMs,
		simulatedTickDuration,
		traderDistribution,
	} = resolveSessionRuntimeConfig(session);
	const persistedState = await loadPersistedSessionState(sessionId);
	const restored = restoreSimulation({
		sessionId,
		symbols,
		seed: session.seed,
		agentCount,
		groupCount,
		tickIntervalMs,
		simulatedTickDuration,
		traderDistribution,
		persistedState: {
			simConfig: {
				isRunning: persistedState.simConfig.isRunning,
				currentTick: persistedState.simConfig.currentTick,
				simulatedMarketTime: persistedState.simConfig.simulatedMarketTime ?? null,
				speedMultiplier: persistedState.simConfig.speedMultiplier,
				tickIntervalMs: persistedState.simConfig.tickIntervalMs,
				lastSummary: persistedState.simConfig.lastSummary,
			},
			agents: persistedState.agents
				.filter((row) => row.tier !== "research")
				.map((row) => ({
					id: row.id,
					status: row.status,
					currentCash: row.currentCash,
					currentNav: row.currentNav,
					positions: row.positions ?? {},
					lastAutopilotDirective:
						(row.lastAutopilotDirective as AutopilotDirective | null) ?? null,
					llmGroup: row.llmGroup,
				})),
			openOrders: persistedState.openOrders.map((row) => ({
				id: row.id,
				tick: row.tick,
				agentId: row.agentId,
				symbol: row.symbol,
				type: row.type,
				side: row.side,
				status: row.status,
				price: row.price,
				quantity: row.quantity,
				filledQuantity: row.filledQuantity,
				llmReasoning: row.llmReasoning,
			})),
			researchNotes: persistedState.researchNotes.map((row) => toResearchNote(row)),
			agentEventCount: persistedState.agentEventCount,
		},
	});

	const eventBus = new EventBus();
	const publicationBus = new PublicationBus();
	publicationBus.hydrate(
		restored.researchNotes,
		restored.runtimeState.currentTick,
	);

	const simClock = new SimClock(simulatedTickDuration, {
		initialTick: restored.runtimeState.currentTick,
		initialTime: restored.runtimeState.simulatedMarketTime ?? undefined,
	});
	const orchestrator = new SimOrchestrator(
		restored.matchingEngine,
		restored.agentRegistry,
		simClock,
		publicationBus,
		eventBus,
		db,
		tradingAgent,
		{
			groupCount,
			sessionId,
			tickIntervalMs: restored.runtimeState.tickIntervalMs,
		},
	);
	orchestrator.hydrateRuntimeState({
		isRunning: restored.runtimeState.isRunning,
		speedMultiplier: restored.runtimeState.speedMultiplier,
		tickIntervalMs: restored.runtimeState.tickIntervalMs,
		lastSummary: restored.runtimeState.lastSummary,
		agentEventSequence: restored.runtimeState.nextAgentEventSequence,
	});

	wireRuntimeBroadcasts(sessionId, eventBus);
	broadcaster.broadcast(`sim:${sessionId}`, orchestrator.getRuntimeState());
	logRuntimeEvent(
		sessionId,
		`resumed tick=${restored.runtimeState.currentTick} running=${restored.runtimeState.isRunning} openOrders=${persistedState.openOrders.length}`,
	);

	return {
		sessionId,
		symbols,
		alpacaClient: hasAlpacaEnv() ? createAlpacaClient() : null,
		eventBus,
		publicationBus,
		researchWorkers: restored.researchWorkers,
		orchestrator,
		nextTickAtMs: Date.now(),
	};
}

export function getMaxLiveSessions(
	input: NodeJS.ProcessEnv = process.env,
): number {
	const parsed = Number(input.SIM_MAX_LIVE_SESSIONS);

	if (!Number.isFinite(parsed) || parsed <= 0) {
		return 2;
	}

	return Math.floor(parsed);
}

export function splitRunnableSessions(
	sessions: RunnableSimulationSession[],
): {
	activeSessions: RunnableSimulationSession[];
	pendingSessions: RunnableSimulationSession[];
} {
	return {
		activeSessions: sessions.filter((session) => session.status === "active"),
		pendingSessions: sessions.filter((session) => session.status === "pending"),
	};
}

export function selectActiveSessionsToResume(input: {
	sessions: RunnableSimulationSession[];
	loadedRuntimeIds: Iterable<string>;
	maxLiveSessions: number;
}): RunnableSimulationSession[] {
	const loadedIds = new Set(input.loadedRuntimeIds);
	const availableCapacity = Math.max(0, input.maxLiveSessions - loadedIds.size);

	if (availableCapacity === 0) {
		return [];
	}

	const { activeSessions } = splitRunnableSessions(input.sessions);

	return activeSessions
		.filter((session) => !loadedIds.has(session.id))
		.slice(0, availableCapacity);
}

export function selectPendingSessionsToBootstrap(input: {
	sessions: RunnableSimulationSession[];
	loadedRuntimeIds: Iterable<string>;
	maxLiveSessions: number;
}): RunnableSimulationSession[] {
	const loadedIds = new Set(input.loadedRuntimeIds);
	const availableCapacity = Math.max(0, input.maxLiveSessions - loadedIds.size);

	if (availableCapacity === 0) {
		return [];
	}

	const { pendingSessions } = splitRunnableSessions(input.sessions);

	return pendingSessions
		.filter((session) => !loadedIds.has(session.id))
		.slice(0, availableCapacity);
}

export function buildDivergenceRows(input: {
	sessionId: string;
	tick: number;
	referencePrices: Map<string, Decimal>;
	quotes: Map<
		string,
		{
			lastPrice: number | null;
			midPrice: number | null;
			bidPrice: number | null;
			askPrice: number | null;
		}
	>;
}) {
	return Array.from(input.referencePrices.entries()).flatMap(([symbol, simPrice]) => {
		const quote = input.quotes.get(symbol);
		const realPrice =
			quote?.lastPrice ?? quote?.midPrice ?? quote?.bidPrice ?? quote?.askPrice;

		if (realPrice === null || realPrice === undefined || realPrice <= 0) {
			return [];
		}

		const simPriceNumber = simPrice.toNumber();
		const divergencePct = Number(
			new Decimal(simPriceNumber)
				.minus(realPrice)
				.div(realPrice)
				.mul(100)
				.toDecimalPlaces(4)
				.toString(),
		);

		return [
			{
				tick: input.tick,
				symbol,
				simPrice: simPriceNumber,
				realPrice,
				divergencePct,
			},
		];
	});
}

async function persistDivergenceLog(runtime: SimulationRuntime): Promise<void> {
	if (!runtime.alpacaClient) {
		return;
	}

	try {
		const quotes = await runtime.alpacaClient.getLatestQuotes(runtime.symbols);
		const rows = buildDivergenceRows({
			sessionId: runtime.sessionId,
			tick: runtime.orchestrator.getRuntimeState().simTick,
			referencePrices: runtime.orchestrator.getReferencePrices(),
			quotes,
		});

		if (rows.length > 0) {
			await db.insert(divergenceLogTable).values(rows);
		}
	} catch (error) {
		console.warn(
			`[SimRunner] Failed to persist divergence log for session ${runtime.sessionId}:`,
			error,
		);
	}
}

export function shouldRunResearchCycle(simTick: number): boolean {
	return simTick > 0 && simTick % 20 === 0;
}

function buildResearchPrompt(worker: ResearchAgentWorker, simTick: number): string {
	return [
		`Simulation tick: ${simTick}`,
		`You are covering the ${worker.focus} desk this cycle.`,
		"Review your assigned sources, scrape the most relevant one or two URLs, and publish at most one actionable research note.",
		"If nothing is actionable, explain why and do not publish a note.",
	].join("\n\n");
}

export async function runResearchCycle(
	workers: ResearchAgentWorker[],
	simTick: number,
	publicationBus: PublicationBus,
	eventBus: EventBus,
	sessionId: string,
	agent: ResearchAgentLike = researchAgent,
): Promise<void> {
	if (!shouldRunResearchCycle(simTick) || workers.length === 0) {
		return;
	}

	const outcomes = await Promise.allSettled(
		workers.map(async (worker) => {
			const requestContext = cloneResearchRequestContext(worker.requestContext);
			requestContext.set("sim-tick", simTick);
			requestContext.set("simulation-session-id", sessionId);
			requestContext.set("publication-bus", publicationBus);
			requestContext.set("event-bus", eventBus);
			requestContext.set("db", db);
			requestContext.set("published-research-note-id", undefined);
			requestContext.set("published-research-note", undefined);

			const result = await agent.generate(
				buildResearchPrompt(worker, simTick),
				{
					requestContext,
					maxSteps: 6,
					structuredOutput: {
						schema: researchCycleResultSchema,
					},
				},
			);

			return researchCycleResultSchema.parse(result.object);
		}),
	);

	for (const [index, outcome] of outcomes.entries()) {
		if (outcome.status === "fulfilled") {
			continue;
		}

		console.error(
			`[Research] ${workers[index]?.id ?? "unknown"} failed at tick ${simTick}:`,
			outcome.reason,
		);
	}
}

async function processRuntimeCycle(
	runtime: SimulationRuntime,
	envIntervalOverride: number | null,
): Promise<void> {
	const { orchestrator, researchWorkers, publicationBus, eventBus, sessionId } =
		runtime;
	const state = orchestrator.getState();

	if (!state.isRunning) {
		const controlOutcome = await orchestrator.processControlCommands();
		for (const message of orchestrator.consumeRuntimeLogMessages()) {
			logRuntimeEvent(sessionId, message);
		}

		if (controlOutcome.processed) {
			broadcaster.broadcast(`sim:${sessionId}`, orchestrator.getRuntimeState());
			if (orchestrator.getState().isRunning) {
				runtime.nextTickAtMs = Date.now();
				return;
			}
		}

		if (controlOutcome.stepCount > 0) {
			for (let index = 0; index < controlOutcome.stepCount; index += 1) {
				try {
					const summary = await orchestrator.tick({ skipPendingCommands: true });
					for (const message of orchestrator.consumeRuntimeLogMessages()) {
						logRuntimeEvent(sessionId, message);
					}
					broadcaster.broadcast(`sim:${sessionId}`, orchestrator.getRuntimeState());
					await persistDivergenceLog(runtime);
					await runResearchCycle(
						researchWorkers,
						orchestrator.getRuntimeState().simTick,
						publicationBus,
						eventBus,
						sessionId,
					);
					logTickSummary(sessionId, summary);
				} catch (error) {
					console.error(`Error during step for session ${sessionId}:`, error);
					break;
				}
			}
		}

		return;
	}

	if (Date.now() < runtime.nextTickAtMs) {
		return;
	}

	const tickStartedAt = Date.now();

	try {
		const summary = await orchestrator.tick();
		for (const message of orchestrator.consumeRuntimeLogMessages()) {
			logRuntimeEvent(sessionId, message);
		}
		broadcaster.broadcast(`sim:${sessionId}`, orchestrator.getRuntimeState());
		await persistDivergenceLog(runtime);
		await runResearchCycle(
			researchWorkers,
			orchestrator.getRuntimeState().simTick,
			publicationBus,
			eventBus,
			sessionId,
		);
		logTickSummary(sessionId, summary);
	} catch (error) {
		console.error(`Error during tick for session ${sessionId}:`, error);
	}

	const elapsed = Date.now() - tickStartedAt;
	const configuredInterval =
		envIntervalOverride ?? orchestrator.getRuntimeState().tickIntervalMs;
	const delay = Math.max(0, configuredInterval - elapsed);
	runtime.nextTickAtMs = Date.now() + delay;
}

async function main() {
	startSimWebSocketServer(3001);

	const runtimes = new Map<string, SimulationRuntime>();
	const envIntervalOverride = process.env.SIM_TICK_INTERVAL_MS
		? Number(process.env.SIM_TICK_INTERVAL_MS)
		: null;
	const maxLiveSessions = getMaxLiveSessions();

	console.log(`[SimRunner] worker started maxLiveSessions=${maxLiveSessions}`);

	while (true) {
		const runnableSessions = await listRunnableSimulationSessions();
		const runnableIds = new Set(runnableSessions.map((session) => session.id));

		for (const runtimeId of Array.from(runtimes.keys())) {
			if (!runnableIds.has(runtimeId)) {
				runtimes.delete(runtimeId);
				logRuntimeEvent(runtimeId, "unloaded");
			}
		}

		const activeSessionsToResume = selectActiveSessionsToResume({
			sessions: runnableSessions,
			loadedRuntimeIds: runtimes.keys(),
			maxLiveSessions,
		});

		for (const session of activeSessionsToResume) {
			try {
				const runtime = await resumeSimulationRuntime(session);
				runtimes.set(session.id, runtime);
			} catch (error) {
				console.error(`Failed to resume session ${session.id}:`, error);
				await markSimulationSessionFailed(session.id);
			}
		}

		const pendingSessionsToBootstrap = selectPendingSessionsToBootstrap({
			sessions: runnableSessions,
			loadedRuntimeIds: runtimes.keys(),
			maxLiveSessions,
		});

		for (const session of pendingSessionsToBootstrap) {
			try {
				const runtime = await bootstrapSimulationRuntime(session);
				runtimes.set(session.id, runtime);
			} catch (error) {
				console.error(`Failed to bootstrap session ${session.id}:`, error);
				await markSimulationSessionFailed(session.id);
			}
		}

		if (runtimes.size === 0) {
			await sleep(250);
			continue;
		}

		for (const runtime of runtimes.values()) {
			await processRuntimeCycle(runtime, envIntervalOverride);
		}

		await sleep(100);
	}
}

const isMainModule =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
	main().catch((error) => {
		console.error("Fatal error:", error);
		process.exit(1);
	});
}
