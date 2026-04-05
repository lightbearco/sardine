import type { OHLCVBar, LOBSnapshot, Trade } from "./market";
import type { ResearchNote } from "./research";
import type { AgentEvent, SimRuntimeState } from "./sim";

// ── Message Types ──

export enum WsMessageType {
	// Server → Client
	OhlcvUpdate = "ohlcv:update",
	LobUpdate = "lob:update",
	TradeUpdate = "trade:update",
	AgentSignal = "agent:signal",
	ResearchPublished = "research:published",
	SimState = "sim:state",
	WorldEventApplied = "world_event:applied",

	// Client → Server
	Subscribe = "subscribe",
	Unsubscribe = "unsubscribe",
	SimCommand = "sim:command",
}

// ── Channel Types ──

export type WsChannel =
	| `ohlcv:${string}` // per-symbol OHLCV
	| `lob:${string}` // per-symbol order book
	| `trades:${string}` // per-symbol trades
	| "agents" // agent signal feed
	| "research" // research note feed
	| "sim" // sim state + controls
	| "world_events"; // world event notifications

// ── Server → Client Messages ──

export interface OhlcvUpdateMessage {
	type: WsMessageType.OhlcvUpdate;
	channel: `ohlcv:${string}`;
	data: OHLCVBar;
}

export interface LobUpdateMessage {
	type: WsMessageType.LobUpdate;
	channel: `lob:${string}`;
	data: LOBSnapshot;
}

export interface TradeUpdateMessage {
	type: WsMessageType.TradeUpdate;
	channel: `trades:${string}`;
	data: Trade[];
}

export interface AgentSignalMessage {
	type: WsMessageType.AgentSignal;
	channel: "agents";
	data: AgentEvent;
}

export interface ResearchPublishedMessage {
	type: WsMessageType.ResearchPublished;
	channel: "research";
	data: ResearchNote;
}

export interface SimStateMessage {
	type: WsMessageType.SimState;
	channel: "sim";
	data: SimRuntimeState;
}

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
	| OhlcvUpdateMessage
	| LobUpdateMessage
	| TradeUpdateMessage
	| AgentSignalMessage
	| ResearchPublishedMessage
	| SimStateMessage
	| WorldEventAppliedMessage;

export type WsClientMessage =
	| SubscribeMessage
	| UnsubscribeMessage
	| SimCommandMessage;

export type WsMessage = WsServerMessage | WsClientMessage;
