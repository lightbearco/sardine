import type { OHLCVBar, LOBSnapshot, Trade } from "./market";
import type { ResearchNote } from "./research";
import type {
	AgentEvent,
	SimulationSessionStatus,
	SimRuntimeState,
} from "./sim";
import type { WatchlistSummaryPayload } from "./watchlist";

// ── Message Types ──

export enum WsMessageType {
	// Server → Client
	OhlcvUpdate = "ohlcv:update",
	LobUpdate = "lob:update",
	TradeUpdate = "trade:update",
	AgentSignal = "agent:signal",
	ResearchPublished = "research:published",
	SimState = "sim:state",
	SessionStatusChanged = "session:status",
	WorldEventApplied = "world_event:applied",

	// Client → Server
	Subscribe = "subscribe",
	Unsubscribe = "unsubscribe",
	SimCommand = "sim:command",
}

// ── Channel Types ──

export type WsChannel =
	| `watchlist:${string}` // per-session watchlist summary
	| `ohlcv:${string}:${string}` // per-session, per-symbol OHLCV
	| `lob:${string}:${string}` // per-session, per-symbol order book
	| `trades:${string}:${string}` // per-session, per-symbol trades
	| `agents:${string}` // per-session agent signal feed
	| `research:${string}` // per-session research note feed
	| `sim:${string}` // per-session sim state + controls
	| "world_events"; // world event notifications

// ── Server → Client Messages ──

export interface WatchlistSummaryMessage {
	type: "watchlist:update";
	channel: `watchlist:${string}`;
	data: WatchlistSummaryPayload;
}

export interface OhlcvUpdateMessage {
	type: WsMessageType.OhlcvUpdate;
	channel: `ohlcv:${string}:${string}`;
	data: OHLCVBar;
}

export interface LobUpdateMessage {
	type: WsMessageType.LobUpdate;
	channel: `lob:${string}:${string}`;
	data: LOBSnapshot;
}

export interface TradeUpdateMessage {
	type: WsMessageType.TradeUpdate;
	channel: `trades:${string}:${string}`;
	data: Trade[];
}

export interface AgentSignalMessage {
	type: WsMessageType.AgentSignal;
	channel: `agents:${string}`;
	data: AgentEvent;
}

export interface ResearchPublishedMessage {
	type: WsMessageType.ResearchPublished;
	channel: `research:${string}`;
	data: ResearchNote;
}

export interface SimStateMessage {
	type: WsMessageType.SimState;
	channel: `sim:${string}`;
	data: SimRuntimeState;
}

export interface SessionStatusChangedMessage {
	type: WsMessageType.SessionStatusChanged;
	channel: `sim:${string}`;
	data: { sessionId: string; status: SimulationSessionStatus };
}

export type SimChannelMessage =
	| { type: "runtime_state"; payload: SimRuntimeState }
	| {
			type: "session_status_changed";
			payload: { sessionId: string; status: SimulationSessionStatus };
	  };

export interface WorldEventAppliedMessage {
	type: WsMessageType.WorldEventApplied;
	channel: "world_events";
	data: { eventId: string; title: string; type: string; magnitude: number };
}

// ── Client → Server Messages ──

export interface SubscribeMessage {
	type: WsMessageType.Subscribe;
	channel: WsChannel;
}

export interface UnsubscribeMessage {
	type: WsMessageType.Unsubscribe;
	channel: WsChannel;
}

export type SimCommandAction = "start" | "pause" | "step" | "setSpeed";

export interface SimCommandMessage {
	type: WsMessageType.SimCommand;
	action: SimCommandAction;
	value?: number;
}

// ── Union Types ──

export type WsServerMessage =
	| WatchlistSummaryMessage
	| OhlcvUpdateMessage
	| LobUpdateMessage
	| TradeUpdateMessage
	| AgentSignalMessage
	| ResearchPublishedMessage
	| SimStateMessage
	| SessionStatusChangedMessage
	| WorldEventAppliedMessage;

export type WsClientMessage =
	| SubscribeMessage
	| UnsubscribeMessage
	| SimCommandMessage;

export type WsMessage = WsServerMessage | WsClientMessage;

type SessionChannelKind = "watchlist" | "agents" | "research" | "sim";
type SymbolChannelKind = "ohlcv" | "lob" | "trades";

export type ParsedWsChannel =
	| {
			kind: SessionChannelKind;
			channel: WsChannel;
			sessionId: string;
	  }
	| {
			kind: SymbolChannelKind;
			channel: WsChannel;
			sessionId: string;
			symbol: string;
	  }
	| {
			kind: "world_events";
			channel: WsChannel;
	  };

function isNonEmptySegment(value: string | undefined): value is string {
	return typeof value === "string" && value.length > 0;
}

export function parseWsChannel(channel: string): ParsedWsChannel | null {
	if (channel === "world_events") {
		return { kind: "world_events", channel };
	}

	const [kind, sessionId, symbol, extra] = channel.split(":");
	if (extra) {
		return null;
	}

	if (
		(kind === "watchlist" ||
			kind === "agents" ||
			kind === "research" ||
			kind === "sim") &&
		isNonEmptySegment(sessionId) &&
		symbol === undefined
	) {
		return {
			kind,
			channel: `${kind}:${sessionId}`,
			sessionId,
		};
	}

	if (
		(kind === "ohlcv" || kind === "lob" || kind === "trades") &&
		isNonEmptySegment(sessionId) &&
		isNonEmptySegment(symbol)
	) {
		return {
			kind,
			channel: `${kind}:${sessionId}:${symbol}`,
			sessionId,
			symbol,
		};
	}

	return null;
}

export function buildSessionChannel(
	kind: SessionChannelKind,
	sessionId: string,
): WsChannel {
	return `${kind}:${sessionId}`;
}

export function buildSymbolChannel(
	kind: SymbolChannelKind,
	sessionId: string,
	symbol: string,
): WsChannel {
	return `${kind}:${sessionId}:${symbol}`;
}
