import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
import { postgresStore } from "#/mastra/stores/postgres";
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
	OHLCVBar,
} from "#/types/market";
import type { ResearchNote } from "#/types/research";
import type {
	AgentEvent,
	SessionDashboardHydration,
	SessionAgentRosterEntry,
	SessionSymbolHydration,
	SessionWatchlistEntry,
	SimulationSessionSummary,
	TickSummary,
	TickSummaryData,
} from "#/types/sim";
import type { AutopilotDirective } from "#/types/agent";

export type DeleteSimulationSessionResult = {
	status: "deleted" | "deleting";
};

const SESSION_NAME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

function buildSessionName(now: Date): string {
	return `Simulation ${SESSION_NAME_FORMATTER.format(now)}`;
}

function toSnapshot(
	row: typeof orderBookSnapshots.$inferSelect,
): LOBSnapshotData {
	const levels = (
		raw:
			| { price: number; qty: number; orderCount: number }[]
			| null
			| undefined,
	) =>
		(raw ?? []).map((level) => ({
			price: level.price,
			qty: level.qty,
			orderCount: level.orderCount,
		}));

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
		activeGroupSize: session.activeGroupSize,
		tickIntervalMs: session.tickIntervalMs,
		simulatedTickDuration: session.simulatedTickDuration,
		llmConcurrency: session.llmConcurrency,
		llmTimeoutMs: session.llmTimeoutMs,
		researchFrequency: session.researchFrequency,
		alpacaDataTypes: session.alpacaDataTypes ?? ["snapshots"],
		traderDistribution:
			session.traderDistribution ??
			buildDefaultTraderDistribution(session.agentCount),
		currentTick,
		createdAt: session.createdAt ?? null,
		updatedAt: session.updatedAt ?? null,
		startedAt: session.startedAt ?? null,
		endedAt: session.endedAt ?? null,
	};
}

function mapResearchNoteRow(
	row: typeof researchNotes.$inferSelect,
): ResearchNote {
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
	return serializeTrade(trade);
}

function decimalLikeToNumber(
	value: number | string | { toNumber: () => number },
): number {
	if (typeof value === "number") {
		return value;
	}

	if (typeof value === "string") {
		return Number(value);
	}

	return value.toNumber();
}

function mapPersistedTickSummary(
	summary: TickSummary | null | undefined,
): TickSummaryData | null {
	if (!summary) {
		return null;
	}

	return {
		...summary,
		simulatedTime: new Date(summary.simulatedTime),
		trades: (summary.trades ?? []).map((trade) =>
			serializeTradeForSummary(trade),
		),
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

async function getSimulationSessionById(sessionId: string) {
	const [session] = await db
		.select()
		.from(simulationSessions)
		.where(eq(simulationSessions.id, sessionId))
		.limit(1);

	return session ?? null;
}

async function deleteSessionObservability(sessionId: string): Promise<void> {
	const observabilityStore = await postgresStore.getStore("observability");

	if (!observabilityStore) {
		return;
	}

	try {
		const traceIds = new Set<string>();
		let page = 0;

		while (true) {
			const response = await observabilityStore.listTraces({
				filters: {
					resourceId: sessionId,
				},
				pagination: {
					page,
					perPage: 100,
				},
			});

			for (const span of response.spans) {
				traceIds.add(span.traceId);
			}

			if (!response.pagination.hasMore) {
				break;
			}

			page += 1;
		}

		if (traceIds.size === 0) {
			return;
		}

		await observabilityStore.batchDeleteTraces({
			traceIds: [...traceIds],
		});
	} catch (error) {
		console.warn(
			`[Sessions] Failed to delete observability data for session ${sessionId}:`,
			error instanceof Error ? error.message : error,
		);
	}
}

export async function hardDeleteSimulationSession(
	sessionId: string,
): Promise<void> {
	await deleteSessionObservability(sessionId);

	await db
		.delete(simulationSessions)
		.where(eq(simulationSessions.id, sessionId));
}

export async function deleteSimulationSession(
	sessionId: string,
): Promise<DeleteSimulationSessionResult> {
	const session = await getSimulationSessionById(sessionId);

	if (!session) {
		return { status: "deleted" };
	}

	if (session.status === "deleting") {
		return { status: "deleting" };
	}

	if (session.status === "completed" || session.status === "failed") {
		await hardDeleteSimulationSession(sessionId);
		return { status: "deleted" };
	}

	await db
		.update(simulationSessions)
		.set({
			status: "deleting",
			endedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(simulationSessions.id, sessionId));

	return { status: "deleting" };
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
		activeGroupSize: parsed.activeGroupSize,
		tickIntervalMs: parsed.tickIntervalMs,
		simulatedTickDuration: parsed.simulatedTickDuration,
		llmConcurrency: parsed.llmConcurrency,
		llmTimeoutMs: parsed.llmTimeoutMs,
		researchFrequency: parsed.researchFrequency,
		alpacaDataTypes: parsed.alpacaDataTypes,
		traderDistribution: parsed.traderDistribution,
		createdAt: now,
		updatedAt: now,
	});

	return { sessionId };
}

export async function listSimulationSessions(): Promise<
	SimulationSessionSummary[]
> {
	const sessions = await db
		.select()
		.from(simulationSessions)
		.orderBy(
			desc(simulationSessions.updatedAt),
			desc(simulationSessions.createdAt),
		);

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
		.where(inArray(simulationSessions.status, ["pending", "active"]))
		.orderBy(
			desc(simulationSessions.updatedAt),
			desc(simulationSessions.createdAt),
		)
		.limit(100);

	const activeSessions = sessions.filter(
		(session) => session.status === "active",
	);
	const pendingSessions = sessions.filter(
		(session) => session.status === "pending",
	);

	return [...activeSessions, ...pendingSessions];
}

export async function listDeletingSimulationSessions(): Promise<
	(typeof simulationSessions.$inferSelect)[]
> {
	return db
		.select()
		.from(simulationSessions)
		.where(eq(simulationSessions.status, "deleting"))
		.orderBy(
			desc(simulationSessions.updatedAt),
			desc(simulationSessions.createdAt),
		)
		.limit(100);
}

export async function markSimulationSessionActive(
	sessionId: string,
): Promise<void> {
	const now = new Date();

	await db
		.update(simulationSessions)
		.set({
			status: "active",
			startedAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(simulationSessions.id, sessionId),
				inArray(simulationSessions.status, ["pending", "active"]),
			),
		);
}

export async function markSimulationSessionFailed(
	sessionId: string,
): Promise<void> {
	const now = new Date();

	await db
		.update(simulationSessions)
		.set({
			status: "failed",
			endedAt: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(simulationSessions.id, sessionId),
				inArray(simulationSessions.status, ["pending", "active"]),
			),
		);
}

export async function getSessionDashboardHydration(input: {
	sessionId: string;
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

	const supportedSymbols = getSupportedSessionSymbols(session.symbols);
	const [
		snapshotRows,
		noteRows,
		agentRows,
		agentEventRows,
		latestBarResults,
		divergenceRows,
	] = await Promise.all([
		db
			.select()
			.from(orderBookSnapshots)
			.where(eq(orderBookSnapshots.sessionId, input.sessionId)),
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
		Promise.all(
			supportedSymbols.map(async (symbol) => {
				const [row] = await db
					.select()
					.from(ticks)
					.where(
						and(eq(ticks.sessionId, input.sessionId), eq(ticks.symbol, symbol)),
					)
					.orderBy(desc(ticks.tick), desc(ticks.createdAt))
					.limit(1);

				if (!row) {
					return null;
				}

				return [symbol, toBar(row)] as const;
			}),
		),
		db
			.execute<{ symbol: string; divergencePct: number }>(
				sql`SELECT DISTINCT ON (symbol) symbol, divergence_pct FROM divergence_log WHERE session_id = ${input.sessionId} ORDER BY symbol, tick DESC`,
			)
			.then((result) => result.rows),
	]);

	const latestBarBySymbol = new Map(
		latestBarResults.filter(
			(entry): entry is readonly [string, OHLCVBarData] => entry !== null,
		),
	);

	const snapshotBySymbol = new Map(
		snapshotRows.map((row) => [row.symbol, toSnapshot(row)]),
	);

	const divergenceBySymbol = new Map(
		divergenceRows.map((row) => [row.symbol, row.divergencePct]),
	);

	const watchlist: Record<string, SessionWatchlistEntry> = Object.fromEntries(
		supportedSymbols.map((symbol) => [
			symbol,
			{
				lastBar: latestBarBySymbol.get(symbol) ?? null,
				snapshot: snapshotBySymbol.get(symbol) ?? null,
				divergencePct: divergenceBySymbol.get(symbol) ?? null,
			},
		]),
	);
	const groupCount = Math.max(0, ...agentRows.map((row) => row.llmGroup)) + 1;
	const activeGroupIndex =
		configRow === undefined
			? 0
			: getActiveGroupIndex(configRow.currentTick, groupCount);
	const activeGroupSize = agentRows.filter(
		(row) => row.status === "active" && row.llmGroup === activeGroupIndex,
	).length;

	return {
		session: mapSessionSummary(session, configRow?.currentTick ?? 0),
		isLive: session.status === "active" || session.status === "pending",
		simState:
			configRow === undefined
				? null
				: {
						isRunning: configRow.isRunning,
						isTicking: false,
						simTick: configRow.currentTick,
						simulatedTime:
							configRow.simulatedMarketTime ??
							configRow.updatedAt ??
							new Date(),
						activeGroupIndex,
						speedMultiplier: configRow.speedMultiplier,
						tickIntervalMs: configRow.tickIntervalMs,
						activeGroupSize,
						symbolCount: supportedSymbols.length,
						agentCount: agentRows.length,
						lastSummary: mapPersistedTickSummary(configRow.lastSummary),
					},
		watchlist,
		researchNotes: noteRows.map(mapResearchNoteRow),
		agentRoster: agentRows.map(mapAgentRosterEntry),
		agentEvents: agentEventRows.map(mapAgentEventRow).reverse(),
	};
}

export async function getSessionSymbolHydration(input: {
	sessionId: string;
	symbol: string;
}): Promise<SessionSymbolHydration | null> {
	const [session] = await db
		.select()
		.from(simulationSessions)
		.where(eq(simulationSessions.id, input.sessionId))
		.limit(1);

	if (!session) {
		return null;
	}

	const resolvedSymbol = normalizeSessionSymbol(input.symbol, session.symbols);
	const [barRows, tradeRows, snapshotRows] = await Promise.all([
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
			.from(orderBookSnapshots)
			.where(
				and(
					eq(orderBookSnapshots.sessionId, input.sessionId),
					eq(orderBookSnapshots.symbol, resolvedSymbol),
				),
			)
			.limit(1),
	]);

	return {
		symbol: resolvedSymbol,
		bars: barRows.map(toBar).reverse(),
		snapshot: snapshotRows[0] ? toSnapshot(snapshotRows[0]) : null,
		trades: tradeRows.map(toTrade),
	};
}

export async function hasSimulationSession(
	sessionId: string,
): Promise<boolean> {
	const [session] = await db
		.select({ id: simulationSessions.id })
		.from(simulationSessions)
		.where(eq(simulationSessions.id, sessionId))
		.limit(1);

	return session !== undefined;
}

export function serializeOhlcvBar(bar: OHLCVBar): OHLCVBarData {
	return {
		symbol: bar.symbol,
		open: decimalLikeToNumber(bar.open),
		high: decimalLikeToNumber(bar.high),
		low: decimalLikeToNumber(bar.low),
		close: decimalLikeToNumber(bar.close),
		volume: bar.volume,
		tick: bar.tick,
	};
}

export function serializeTrade(trade: Trade): TradeData {
	return {
		id: trade.id,
		buyOrderId: trade.buyOrderId,
		sellOrderId: trade.sellOrderId,
		buyerAgentId: trade.buyerAgentId,
		sellerAgentId: trade.sellerAgentId,
		symbol: trade.symbol,
		price: decimalLikeToNumber(trade.price),
		qty: trade.qty,
		tick: trade.tick,
	};
}

export function serializeOrderBookLevels(levels: LOBSnapshot["bids"]) {
	return levels.map((level) => ({
		price: decimalLikeToNumber(level.price),
		qty: level.qty,
		orderCount: level.orderCount,
	}));
}

export function serializeLobSnapshot(snapshot: LOBSnapshot): LOBSnapshotData {
	return {
		symbol: snapshot.symbol,
		bids: serializeOrderBookLevels(snapshot.bids),
		asks: serializeOrderBookLevels(snapshot.asks),
		lastPrice:
			snapshot.lastPrice === null
				? null
				: decimalLikeToNumber(snapshot.lastPrice),
		spread:
			snapshot.spread === null ? null : decimalLikeToNumber(snapshot.spread),
	};
}

export function serializeOrderBookSnapshot(input: {
	sessionId: string;
	snapshot: LOBSnapshot;
	tick: number;
}) {
	const normalizeLevels = (levels: LOBSnapshot["bids"]) =>
		serializeOrderBookLevels(levels);

	return {
		sessionId: input.sessionId,
		symbol: input.snapshot.symbol,
		tick: input.tick,
		bids: normalizeLevels(input.snapshot.bids),
		asks: normalizeLevels(input.snapshot.asks),
		lastPrice:
			input.snapshot.lastPrice === null
				? null
				: input.snapshot.lastPrice.toNumber(),
		spread:
			input.snapshot.spread === null ? null : input.snapshot.spread.toNumber(),
		updatedAt: new Date(),
	};
}
