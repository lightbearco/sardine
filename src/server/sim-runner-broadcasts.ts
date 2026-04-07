import { createLogger } from "#/lib/logger";
import {
	serializeLobSnapshot,
	serializeOhlcvBar,
	serializeTrade,
} from "#/server/sessions";
import type { TickSummary } from "#/types/sim";
import type { SimRuntimeState, SimRuntimeStateData } from "#/types/sim";
import type { WatchlistSummaryPayload } from "#/types/watchlist";
import {
	buildSessionChannel,
	buildSymbolChannel,
	type SimChannelMessage,
} from "#/types/ws";
import type { EventBus } from "#/engine/bus/EventBus";
import { broadcaster } from "./ws/broadcaster";

const log = createLogger("SimRunner");

type BroadcastChannel = "ohlcv" | "lob" | "trades" | "agents" | "thinking";

type BroadcastCounters = Record<BroadcastChannel, number>;

const shouldLogWebsocketStats = process.env.SIM_WS_VERBOSE_LOGS === "1";
const broadcastCounters = new Map<string, BroadcastCounters>();

function createBroadcastCounters(): BroadcastCounters {
	return {
		ohlcv: 0,
		lob: 0,
		trades: 0,
		agents: 0,
		thinking: 0,
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

function clearBroadcastCounters(sessionId: string) {
	broadcastCounters.delete(sessionId);
}

function trackBroadcast(sessionId: string, channel: BroadcastChannel) {
	const counters = ensureBroadcastCounters(sessionId);
	counters[channel] += 1;
}

function serializeRuntimeStateForBroadcast(
	state: SimRuntimeState,
): SimRuntimeStateData {
	return {
		isRunning: state.isRunning,
		isTicking: state.isTicking,
		simTick: state.simTick,
		simulatedTime: state.simulatedTime,
		activeGroupIndex: state.activeGroupIndex,
		speedMultiplier: state.speedMultiplier,
		tickIntervalMs: state.tickIntervalMs,
		activeGroupSize: state.activeGroupSize,
		symbolCount: state.symbolCount,
		agentCount: state.agentCount,
		lastSummary: state.lastSummary
			? {
					durationMs: state.lastSummary.durationMs,
					orderCount: state.lastSummary.orderCount,
					tradeCount: state.lastSummary.tradeCount,
					activeAgents: state.lastSummary.activeAgents,
					simTick: state.lastSummary.simTick,
					simulatedTime: state.lastSummary.simulatedTime,
					trades: state.lastSummary.trades.map((trade) => ({
						id: trade.id,
						buyOrderId: trade.buyOrderId,
						sellOrderId: trade.sellOrderId,
						buyerAgentId: trade.buyerAgentId,
						sellerAgentId: trade.sellerAgentId,
						symbol: trade.symbol,
						price: trade.price.toNumber(),
						qty: trade.qty,
						tick: trade.tick,
					})),
					isRunning: state.lastSummary.isRunning,
				}
			: null,
	};
}

export function mergeWatchlistSummary(
	current: WatchlistSummaryPayload | undefined,
	patch: Partial<WatchlistSummaryPayload>,
	now: number,
): WatchlistSummaryPayload {
	return {
		symbol: patch.symbol ?? current?.symbol ?? "",
		lastPrice:
			patch.lastPrice ??
			patch.lastTrade?.price ??
			patch.lastBar?.close ??
			current?.lastPrice ??
			null,
		high: patch.high ?? patch.lastBar?.high ?? current?.high ?? null,
		low: patch.low ?? patch.lastBar?.low ?? current?.low ?? null,
		spread: patch.spread ?? patch.snapshot?.spread ?? current?.spread ?? null,
		lastBar: patch.lastBar ?? current?.lastBar,
		snapshot: patch.snapshot ?? current?.snapshot,
		lastTrade: patch.lastTrade ?? current?.lastTrade,
		updatedAt: now,
	};
}

export function broadcastSimRuntimeState(
	sessionId: string,
	state: SimRuntimeState,
): void {
	const message: SimChannelMessage = {
		type: "runtime_state",
		payload: serializeRuntimeStateForBroadcast(state),
	};
	broadcaster.broadcast(buildSessionChannel("sim", sessionId), message);
}

export function broadcastSessionStatus(
	sessionId: string,
	status: import("#/types/sim").SimulationSessionStatus,
): void {
	const message: SimChannelMessage = {
		type: "session_status_changed",
		payload: { sessionId, status },
	};
	broadcaster.broadcast(buildSessionChannel("sim", sessionId), message);
}

export function logRuntimeEvent(sessionId: string, message: string): void {
	log.info({ sessionId }, message);
}

export function logTickSummary(sessionId: string, summary: TickSummary): void {
	log.info(
		{
			sessionId,
			simTick: summary.simTick,
			durationMs: summary.durationMs,
			trades: summary.tradeCount,
			orders: summary.orderCount,
			running: summary.isRunning,
		},
		"tick completed",
	);
	logBroadcastCounters(sessionId);
}

export function logBroadcastCounters(sessionId: string) {
	if (!shouldLogWebsocketStats) {
		return;
	}

	const counters = broadcastCounters.get(sessionId);
	if (!counters) {
		return;
	}

	const { ohlcv, lob, trades, agents } = counters;
	log.info(
		{ sessionId, ohlcv, lob, trades, agents },
		"websocket events this tick",
	);

	broadcastCounters.set(sessionId, createBroadcastCounters());
}

export function clearRuntimeBroadcasts(
	sessionId: string,
	options?: { clearSession?: boolean },
): void {
	clearBroadcastCounters(sessionId);
	if (options?.clearSession ?? true) {
		broadcaster.clearSession(sessionId);
	}
}

export function wireRuntimeBroadcasts(
	sessionId: string,
	eventBus: EventBus,
): void {
	resetBroadcastCounters(sessionId);
	const watchlistSummaries = new Map<string, WatchlistSummaryPayload>();

	const emitWatchlistUpdate = (
		symbol: string,
		patch: Partial<WatchlistSummaryPayload>,
	) => {
		const now = Date.now();
		const merged = mergeWatchlistSummary(
			watchlistSummaries.get(symbol) ?? {
				symbol,
				lastPrice: null,
				high: null,
				low: null,
				spread: null,
				updatedAt: now,
			},
			{ ...patch, symbol },
			now,
		);
		watchlistSummaries.set(symbol, merged);
		broadcaster.broadcast(buildSessionChannel("watchlist", sessionId), merged);
	};

	eventBus.on("ohlcv", (bar) => {
		const serializedBar = serializeOhlcvBar(bar);
		broadcaster.broadcast(
			buildSymbolChannel("ohlcv", sessionId, bar.symbol),
			serializedBar,
		);
		trackBroadcast(sessionId, "ohlcv");
		emitWatchlistUpdate(bar.symbol, {
			lastBar: serializedBar,
			lastPrice: serializedBar.close,
			high: serializedBar.high,
			low: serializedBar.low,
		});
	});

	eventBus.on("lob-update", (snapshot) => {
		const serializedSnapshot = serializeLobSnapshot(snapshot);
		broadcaster.broadcast(
			buildSymbolChannel("lob", sessionId, snapshot.symbol),
			serializedSnapshot,
		);
		trackBroadcast(sessionId, "lob");
		emitWatchlistUpdate(snapshot.symbol, {
			snapshot: serializedSnapshot,
			spread: serializedSnapshot.spread,
			lastPrice: serializedSnapshot.lastPrice ?? null,
		});
	});

	eventBus.on("trade", (trade) => {
		const serializedTrade = serializeTrade(trade);
		broadcaster.broadcast(
			buildSymbolChannel("trades", sessionId, trade.symbol),
			[serializedTrade],
		);
		trackBroadcast(sessionId, "trades");
		emitWatchlistUpdate(trade.symbol, {
			lastTrade: serializedTrade,
			lastPrice: serializedTrade.price,
		});
	});

	eventBus.on("agent-event", (event) => {
		broadcaster.broadcast(buildSessionChannel("agents", sessionId), event);
		trackBroadcast(sessionId, "agents");
	});

	eventBus.on("agent-thinking", (delta) => {
		broadcaster.broadcast(buildSessionChannel("thinking", sessionId), delta);
		trackBroadcast(sessionId, "thinking");
	});

	eventBus.on("research-published", (note) => {
		broadcaster.broadcast(buildSessionChannel("research", sessionId), note);
	});

	eventBus.on("world-event", (event) => {
		broadcaster.broadcast("world_events", event);
	});

	eventBus.on("sim-state", (state) => {
		broadcastSimRuntimeState(sessionId, state);
	});
}
