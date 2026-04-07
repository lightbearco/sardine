import { and, asc, eq, inArray } from "drizzle-orm";
import {
	bootstrapSimulation,
	restoreSimulation,
	type ResearchAgentWorker,
} from "#/agents/bootstrap";
import {
	createAlpacaClient,
	hasAlpacaEnv,
	type AlpacaDataType,
} from "#/alpaca/client";
import { loadBootstrapMarketData } from "#/alpaca/live-feed";
import { db } from "#/db/index";
import {
	agentEvents as agentEventsTable,
	agents as agentsTable,
	orderBookSnapshots as orderBookSnapshotsTable,
	orders as ordersTable,
	researchNotes as researchNotesTable,
	simConfig as simConfigTable,
} from "#/db/schema";
import { EventBus } from "#/engine/bus/EventBus";
import { PublicationBus } from "#/engine/bus/PublicationBus";
import { SimClock } from "#/engine/sim/SimClock";
import { SimOrchestrator } from "#/engine/sim/SimOrchestrator";
import { DEV_TICKERS, SIM_DEFAULTS } from "#/lib/constants";
import { createLogger } from "#/lib/logger";
import {
	buildDefaultTraderDistribution,
	deriveGroupCount,
} from "#/lib/simulation-session";
import { tradingAgent } from "#/mastra/agents/trading-agent";
import type { AutopilotDirective } from "#/types/agent";
import type { ResearchFocus } from "#/types/research";
import {
	listRunnableSimulationSessions,
	markSimulationSessionActive,
} from "#/server/sessions";
import {
	broadcastSessionStatus,
	broadcastSimRuntimeState,
	logRuntimeEvent,
	wireRuntimeBroadcasts,
} from "./sim-runner-broadcasts";

const log = createLogger("SimRunner");

export type SimulationRuntime = {
	sessionId: string;
	symbols: string[];
	eventBus: EventBus;
	publicationBus: PublicationBus;
	researchWorkers: ResearchAgentWorker[];
	orchestrator: SimOrchestrator;
	nextTickAtMs: number;
	activeGroupSize: number;
	researchFrequency: number;
	researchInProgress: boolean;
	disposePromise: Promise<void> | null;
};

export type RunnableSimulationSession = Awaited<
	ReturnType<typeof listRunnableSimulationSessions>
>[number];

type PersistedSimConfigRow = typeof simConfigTable.$inferSelect;
type PersistedAgentRow = typeof agentsTable.$inferSelect;
type PersistedOrderBookSnapshotRow = typeof orderBookSnapshotsTable.$inferSelect;
type PersistedOpenOrderRow = typeof ordersTable.$inferSelect;
type PersistedResearchNoteRow = typeof researchNotesTable.$inferSelect;

async function createBootstrapMarketData(
	symbols: string[],
	alpacaDataTypes: string[] = [...SIM_DEFAULTS.alpacaDataTypes],
): Promise<{
	marketData: Awaited<ReturnType<typeof loadBootstrapMarketData>> | null;
}> {
	if (!hasAlpacaEnv()) {
		log.error(
			"Alpaca env vars missing (ALPACA_API_KEY, ALPACA_API_SECRET, ALPACA_BASE_URL); falling back to local seed prices.",
		);
		return { marketData: null };
	}

	const alpacaClient = createAlpacaClient();

	try {
		return {
			marketData: await loadBootstrapMarketData(
				symbols,
				alpacaClient,
				alpacaDataTypes as AlpacaDataType[],
			),
		};
	} catch (error) {
		log.error(
			{ err: error },
			"Alpaca bootstrap failed; falling back to local seed prices. Verify ALPACA_API_KEY and ALPACA_API_SECRET in .env.local.",
		);
		return { marketData: null };
	}
}

export function resolveSessionRuntimeConfig(
	session: RunnableSimulationSession,
): {
	symbols: string[];
	agentCount: number;
	groupCount: number;
	activeGroupSize: number;
	tickIntervalMs: number;
	simulatedTickDuration: number;
	llmConcurrency: number;
	llmTimeoutMs: number;
	researchFrequency: number;
	alpacaDataTypes: string[];
	traderDistribution: ReturnType<typeof buildDefaultTraderDistribution>;
} {
	const symbols =
		session.symbols.length > 0
			? session.symbols
			: DEV_TICKERS.map((ticker) => ticker.symbol);
	const agentCount = session.agentCount ?? SIM_DEFAULTS.agentCount;
	const activeGroupSize =
		session.activeGroupSize ?? SIM_DEFAULTS.activeGroupSize;

	return {
		symbols,
		agentCount,
		activeGroupSize,
		groupCount: deriveGroupCount(agentCount, activeGroupSize),
		tickIntervalMs: session.tickIntervalMs ?? SIM_DEFAULTS.tickIntervalMs,
		simulatedTickDuration:
			session.simulatedTickDuration ?? SIM_DEFAULTS.simulatedTickDuration,
		llmConcurrency: session.llmConcurrency ?? SIM_DEFAULTS.llmConcurrency,
		llmTimeoutMs: session.llmTimeoutMs ?? SIM_DEFAULTS.llmTimeoutMs,
		researchFrequency:
			session.researchFrequency ?? SIM_DEFAULTS.researchFrequency,
		alpacaDataTypes: session.alpacaDataTypes ?? [
			...SIM_DEFAULTS.alpacaDataTypes,
		],
		traderDistribution:
			session.traderDistribution ?? buildDefaultTraderDistribution(agentCount),
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

async function loadPersistedSessionState(sessionId: string): Promise<{
	simConfig: PersistedSimConfigRow;
	agents: PersistedAgentRow[];
	snapshots: PersistedOrderBookSnapshotRow[];
	openOrders: PersistedOpenOrderRow[];
	researchNotes: PersistedResearchNoteRow[];
	agentEventCount: number;
}> {
	const [
		simConfigRows,
		agentRows,
		snapshotRows,
		openOrderRows,
		researchNoteRows,
		agentEventRows,
	] = await Promise.all([
		db
			.select()
			.from(simConfigTable)
			.where(eq(simConfigTable.sessionId, sessionId))
			.limit(1),
		db.select().from(agentsTable).where(eq(agentsTable.sessionId, sessionId)),
		db
			.select()
			.from(orderBookSnapshotsTable)
			.where(eq(orderBookSnapshotsTable.sessionId, sessionId)),
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
			.orderBy(
				asc(researchNotesTable.publishedAtTick),
				asc(researchNotesTable.createdAt),
			),
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
		snapshots: snapshotRows,
		openOrders: openOrderRows,
		researchNotes: researchNoteRows,
		agentEventCount: agentEventRows.length,
	};
}

export async function bootstrapSimulationRuntime(
	session: RunnableSimulationSession,
): Promise<SimulationRuntime> {
	const sessionId = session.id;
	const {
		symbols,
		agentCount,
		groupCount,
		activeGroupSize,
		tickIntervalMs,
		simulatedTickDuration,
		llmConcurrency,
		llmTimeoutMs,
		researchFrequency,
		alpacaDataTypes,
		traderDistribution,
	} = resolveSessionRuntimeConfig(session);
	const { marketData } = await createBootstrapMarketData(
		symbols,
		alpacaDataTypes,
	);
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
	const simClock = new SimClock(simulatedTickDuration, {
		initialTick: bootstrap.initialTick,
	});
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
			llmConcurrency,
			llmTimeoutMs,
		},
	);

	wireRuntimeBroadcasts(sessionId, eventBus);
	await markSimulationSessionActive(sessionId);
	await orchestrator.start();
	broadcastSimRuntimeState(sessionId, orchestrator.getRuntimeState());
	broadcastSessionStatus(sessionId, "active");

	logRuntimeEvent(
		sessionId,
		`bootstrapped agents=${bootstrap.agentRegistry.getAll().length} initialTick=${bootstrap.initialTick}`,
	);

	return {
		sessionId,
		symbols,
		eventBus,
		publicationBus,
		researchWorkers: bootstrap.researchWorkers,
		orchestrator,
		nextTickAtMs: Date.now(),
		activeGroupSize,
		researchFrequency,
		researchInProgress: false,
		disposePromise: null,
	};
}

export async function resumeSimulationRuntime(
	session: RunnableSimulationSession,
): Promise<SimulationRuntime> {
	const sessionId = session.id;
	const {
		symbols,
		agentCount,
		groupCount,
		activeGroupSize,
		tickIntervalMs,
		simulatedTickDuration,
		llmConcurrency,
		llmTimeoutMs,
		researchFrequency,
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
				simulatedMarketTime:
					persistedState.simConfig.simulatedMarketTime ?? null,
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
					realizedPnl: (row.realizedPnl as Record<string, number> | null) ?? {},
					lastAutopilotDirective:
						(row.lastAutopilotDirective as AutopilotDirective | null) ?? null,
					lastLlmTick: row.lastLlmTick ?? null,
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
			snapshots: persistedState.snapshots.map((row) => ({
				symbol: row.symbol,
				tick: row.tick,
				bids: row.bids ?? [],
				asks: row.asks ?? [],
				lastPrice: row.lastPrice,
			})),
			researchNotes: persistedState.researchNotes.map((row) =>
				toResearchNote(row),
			),
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
			llmConcurrency,
			llmTimeoutMs,
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
	broadcastSimRuntimeState(sessionId, orchestrator.getRuntimeState());
	broadcastSessionStatus(sessionId, "active");
	logRuntimeEvent(
		sessionId,
		`resumed tick=${restored.runtimeState.currentTick} running=${restored.runtimeState.isRunning} openOrders=${persistedState.openOrders.length}`,
	);

	return {
		sessionId,
		symbols,
		eventBus,
		publicationBus,
		researchWorkers: restored.researchWorkers,
		orchestrator,
		nextTickAtMs: Date.now(),
		activeGroupSize,
		researchFrequency,
		researchInProgress: false,
		disposePromise: null,
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

export function splitRunnableSessions(sessions: RunnableSimulationSession[]): {
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
