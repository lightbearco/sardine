import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getActiveGroupIndex } from "#/agents/batch-scheduler";
import { db } from "#/db/index";
import {
	agentEvents,
	agents,
	orderBookSnapshots,
	researchNotes,
	simConfig,
	simulationSessions,
	ticks,
	trades,
} from "#/db/schema";
import {
	getSupportedSessionSymbols,
	normalizeSessionSymbol,
} from "#/lib/session-symbols";
import {
	buildDefaultTraderDistribution,
	buildSessionSymbols,
	createSimulationSessionInputSchema,
	deriveGroupCount,
	type CreateSimulationSessionInput,
} from "#/lib/simulation-session";
import type {
	LOBSnapshot,
	LOBSnapshotData,
	Trade,
	OHLCVBarData,
	TradeData,
} from "#/types/market";
import type { ResearchNote } from "#/types/research";
import type {
	AgentEvent,
	SessionDashboardHydration,
	SessionAgentRosterEntry,
	SessionWatchlistEntry,
	SimulationSessionSummary,
	TickSummary,
	TickSummaryData,
} from "#/types/sim";
import type { AutopilotDirective } from "#/types/agent";

const SESSION_NAME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

function buildSessionName(now: Date): string {
	return `Simulation ${SESSION_NAME_FORMATTER.format(now)}`;
}

function toSnapshot(row: typeof orderBookSnapshots.$inferSelect): LOBSnapshotData {
	const levels = (raw: { price: number; qty: number; orderCount: number }[] | null | undefined) =>
		(raw ?? []).map((level) => ({ price: level.price, qty: level.qty, orderCount: level.orderCount }));

	return {
		symbol: row.symbol,
		bids: levels(row.bids),
		asks: levels(row.asks),
		lastPrice: row.lastPrice ?? null,
		spread: row.spread ?? null,
	};
}

function toBar(row: typeof ticks.$inferSelect): OHLCVBarData {
	return {
		symbol: row.symbol,
		open: row.open,
		high: row.high,
		low: row.low,
		close: row.close,
		volume: row.volume,
		tick: row.tick,
	};
}

function toTrade(row: typeof trades.$inferSelect): TradeData {
	return {
		id: row.id,
		buyOrderId: row.buyOrderId,
		sellOrderId: row.sellOrderId,
		buyerAgentId: row.buyerAgentId,
		sellerAgentId: row.sellerAgentId,
		symbol: row.symbol,
		price: row.price,
		qty: row.quantity,
		tick: row.tick,
	};
}

function mapSessionSummary(
	session: typeof simulationSessions.$inferSelect,
	currentTick: number,
): SimulationSessionSummary {
	return {
		id: session.id,
		name: session.name,
		status: session.status,
		symbols: session.symbols ?? [],
		seed: session.seed,
		agentCount: session.agentCount,
		groupCount: session.groupCount,
		tickIntervalMs: session.tickIntervalMs,
		simulatedTickDuration: session.simulatedTickDuration,
		traderDistribution:
			session.traderDistribution ?? buildDefaultTraderDistribution(session.agentCount),
		currentTick,
		createdAt: session.createdAt ?? null,
		updatedAt: session.updatedAt ?? null,
		startedAt: session.startedAt ?? null,
		endedAt: session.endedAt ?? null,
	};
}

function mapResearchNoteRow(row: typeof researchNotes.$inferSelect): ResearchNote {
	return {
		id: row.noteId,
		agentId: row.agentId,
		focus: row.focus as ResearchNote["focus"],
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

function serializeTradeForSummary(trade: Trade): TradeData {
	return {
		id: trade.id,
		buyOrderId: trade.buyOrderId,
		sellOrderId: trade.sellOrderId,
		buyerAgentId: trade.buyerAgentId,
		sellerAgentId: trade.sellerAgentId,
		symbol: trade.symbol,
		price: trade.price.toNumber(),
		qty: trade.qty,
		tick: trade.tick,
	};
}

function mapPersistedTickSummary(summary: TickSummary | null | undefined): TickSummaryData | null {
	if (!summary) {
		return null;
	}

	return {
		...summary,
		simulatedTime: new Date(summary.simulatedTime),
		trades: (summary.trades ?? []).map((trade) => serializeTradeForSummary(trade)),
	};
}

function mapAgentRosterEntry(
	row: typeof agents.$inferSelect,
): SessionAgentRosterEntry {
	return {
		id: row.id,
		name: row.name,
		tier: row.tier,
		status: row.status,
		entityType: row.entityType,
		strategyType: row.strategyType,
		currentCash: row.currentCash,
		currentNav: row.currentNav,
		positions: row.positions ?? {},
		lastAutopilotDirective:
			(row.lastAutopilotDirective as AutopilotDirective | null) ?? null,
		lastLlmAt: row.lastLlmAt ?? null,
		llmGroup: row.llmGroup,
	};
}

function mapAgentEventRow(row: typeof agentEvents.$inferSelect): AgentEvent {
	return row.payload;
}

export async function createSimulationSession(
	input: CreateSimulationSessionInput,
): Promise<{ sessionId: string }> {
	const parsed = createSimulationSessionInputSchema.parse(input);
	const now = new Date();
	const sessionId = `sim_${nanoid(10)}`;
	const symbols = buildSessionSymbols(parsed.symbolCount);
	const groupCount = deriveGroupCount(
		parsed.agentCount,
		parsed.activeGroupSize,
	);

	await db.insert(simulationSessions).values({
		id: sessionId,
		name: buildSessionName(now),
		status: "pending",
		symbols,
		seed: 42,
		agentCount: parsed.agentCount,
		groupCount,
		tickIntervalMs: parsed.tickIntervalMs,
		simulatedTickDuration: parsed.simulatedTickDuration,
		traderDistribution: parsed.traderDistribution,
		createdAt: now,
		updatedAt: now,
	});

	return { sessionId };
}

export async function listSimulationSessions(): Promise<SimulationSessionSummary[]> {
	const sessions = await db
		.select()
		.from(simulationSessions)
		.orderBy(desc(simulationSessions.updatedAt), desc(simulationSessions.createdAt));

	if (sessions.length === 0) {
		return [];
	}

	const sessionIds = sessions.map((session) => session.id);
	const configs = await db
		.select()
		.from(simConfig)
		.where(inArray(simConfig.sessionId, sessionIds));

	const currentTickBySession = new Map(
		configs.map((config) => [config.sessionId, config.currentTick]),
	);

	return sessions.map((session) =>
		mapSessionSummary(session, currentTickBySession.get(session.id) ?? 0),
	);
}

export async function listRunnableSimulationSessions(): Promise<
	(typeof simulationSessions.$inferSelect)[]
> {
	const sessions = await db
		.select()
		.from(simulationSessions)
		.where(
			inArray(simulationSessions.status, ["pending", "active"]),
		)
		.orderBy(desc(simulationSessions.updatedAt), desc(simulationSessions.createdAt))
		.limit(100);

	const activeSessions = sessions.filter((session) => session.status === "active");
	const pendingSessions = sessions.filter((session) => session.status === "pending");

	return [...activeSessions, ...pendingSessions];
}

export async function markSimulationSessionActive(sessionId: string): Promise<void> {
	const now = new Date();

	await db
		.update(simulationSessions)
		.set({
			status: "active",
			startedAt: now,
			updatedAt: now,
		})
		.where(eq(simulationSessions.id, sessionId));
}

export async function markSimulationSessionFailed(sessionId: string): Promise<void> {
	const now = new Date();

	await db
		.update(simulationSessions)
		.set({
			status: "failed",
			endedAt: now,
			updatedAt: now,
		})
		.where(eq(simulationSessions.id, sessionId));
}

export async function getSessionDashboardHydration(input: {
	sessionId: string;
	symbol?: string;
}): Promise<SessionDashboardHydration | null> {
	const [session] = await db
		.select()
		.from(simulationSessions)
		.where(eq(simulationSessions.id, input.sessionId))
		.limit(1);

	if (!session) {
		return null;
	}

	const [configRow] = await db
		.select()
		.from(simConfig)
		.where(eq(simConfig.sessionId, input.sessionId))
		.limit(1);

	const resolvedSymbol = normalizeSessionSymbol(input.symbol, session.symbols);
	const [snapshotRows, latestTickRows, barRows, tradeRows, noteRows, agentRows, agentEventRows] =
		await Promise.all([
			db
				.select()
				.from(orderBookSnapshots)
				.where(eq(orderBookSnapshots.sessionId, input.sessionId)),
			db
				.select()
				.from(ticks)
				.where(eq(ticks.sessionId, input.sessionId))
				.orderBy(desc(ticks.tick), desc(ticks.createdAt))
				.limit(500),
			db
				.select()
				.from(ticks)
				.where(
					and(
						eq(ticks.sessionId, input.sessionId),
						eq(ticks.symbol, resolvedSymbol),
					),
				)
				.orderBy(desc(ticks.tick), desc(ticks.createdAt))
				.limit(120),
			db
				.select()
				.from(trades)
				.where(
					and(
						eq(trades.sessionId, input.sessionId),
						eq(trades.symbol, resolvedSymbol),
					),
				)
				.orderBy(desc(trades.tick), desc(trades.createdAt))
				.limit(100),
			db
				.select()
				.from(researchNotes)
				.where(eq(researchNotes.sessionId, input.sessionId))
				.orderBy(
					desc(researchNotes.publishedAtTick),
					desc(researchNotes.createdAt),
				)
				.limit(25),
			db
				.select()
				.from(agents)
				.where(eq(agents.sessionId, input.sessionId))
				.orderBy(agents.name),
			db
				.select()
				.from(agentEvents)
				.where(eq(agentEvents.sessionId, input.sessionId))
				.orderBy(desc(agentEvents.tick), desc(agentEvents.createdAt))
				.limit(200),
		]);

	const snapshotBySymbol = new Map(
		snapshotRows.map((row) => [row.symbol, toSnapshot(row)]),
	);
	const latestBarBySymbol = new Map<string, OHLCVBarData>();

	for (const row of latestTickRows) {
		if (!latestBarBySymbol.has(row.symbol)) {
			latestBarBySymbol.set(row.symbol, toBar(row));
		}
	}

	const supportedSymbols = getSupportedSessionSymbols(session.symbols);
	const watchlist: Record<string, SessionWatchlistEntry> = Object.fromEntries(
		supportedSymbols.map((symbol) => [
			symbol,
			{
				lastBar: latestBarBySymbol.get(symbol) ?? null,
				snapshot: snapshotBySymbol.get(symbol) ?? null,
			},
		]),
	);
	const groupCount =
		Math.max(0, ...agentRows.map((row) => row.llmGroup)) + 1;
	const activeGroupIndex =
		configRow === undefined ? 0 : getActiveGroupIndex(configRow.currentTick, groupCount);
	const activeGroupSize = agentRows.filter(
		(row) => row.status === "active" && row.llmGroup === activeGroupIndex,
	).length;

	return {
		session: mapSessionSummary(session, configRow?.currentTick ?? 0),
		symbol: resolvedSymbol,
		isLive: session.status === "active" || session.status === "pending",
		simState:
			configRow === undefined
				? null
				: {
						isRunning: configRow.isRunning,
						isTicking: false,
						simTick: configRow.currentTick,
						simulatedTime:
							configRow.simulatedMarketTime ?? configRow.updatedAt ?? new Date(),
						activeGroupIndex,
						speedMultiplier: configRow.speedMultiplier,
						tickIntervalMs: configRow.tickIntervalMs,
						activeGroupSize,
						symbolCount: supportedSymbols.length,
						agentCount: agentRows.length,
						lastSummary: mapPersistedTickSummary(configRow.lastSummary),
					},
		watchlist,
		bars: barRows.map(toBar).reverse(),
		snapshot: snapshotBySymbol.get(resolvedSymbol) ?? null,
		trades: tradeRows.map(toTrade),
		researchNotes: noteRows.map(mapResearchNoteRow),
		agentRoster: agentRows.map(mapAgentRosterEntry),
		agentEvents: agentEventRows.map(mapAgentEventRow).reverse(),
	};
}

export function serializeOrderBookSnapshot(input: {
	sessionId: string;
	snapshot: LOBSnapshot;
	tick: number;
}) {
	const normalizeLevels = (levels: LOBSnapshot["bids"]) =>
		levels.map((level) => ({ price: Number(level.price), qty: level.qty, orderCount: level.orderCount }));

	return {
		sessionId: input.sessionId,
		symbol: input.snapshot.symbol,
		tick: input.tick,
		bids: normalizeLevels(input.snapshot.bids),
		asks: normalizeLevels(input.snapshot.asks),
		lastPrice: input.snapshot.lastPrice === null ? null : input.snapshot.lastPrice.toNumber(),
		spread: input.snapshot.spread === null ? null : input.snapshot.spread.toNumber(),
		updatedAt: new Date(),
	};
}
