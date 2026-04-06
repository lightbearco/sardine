import { z } from "zod";
import type {
	LOBSnapshotData,
	OHLCVBarData,
	Order,
	OrderSide,
	OrderStatus,
	OrderType,
	Trade,
	TradeData,
} from "#/types/market";
import type { AgentStatus, AgentTier, AutopilotDirective } from "#/types/agent";
import type { ResearchNote } from "#/types/research";
import type { TraderDistribution } from "#/lib/simulation-session";

// ── Sim Config ──

export interface SimConfig {
	isRunning: boolean;
	currentTick: number;
	simulatedMarketTime: Date | null;
	speedMultiplier: number;
	tickIntervalMs: number;
	activeGroupSize: number;
	symbolCount: number;
	agentCount: number;
}

export interface SimRuntimeState {
	isRunning: boolean;
	isTicking: boolean;
	simTick: number;
	simulatedTime: Date;
	activeGroupIndex: number;
	speedMultiplier: number;
	tickIntervalMs: number;
	activeGroupSize: number;
	symbolCount: number;
	agentCount: number;
	lastSummary: TickSummary | null;
}

export interface TickSummaryData {
	durationMs: number;
	orderCount: number;
	tradeCount: number;
	activeAgents: number;
	simTick: number;
	simulatedTime: Date;
	trades: TradeData[];
	isRunning: boolean;
}

export interface SimRuntimeStateData {
	isRunning: boolean;
	isTicking: boolean;
	simTick: number;
	simulatedTime: Date;
	activeGroupIndex: number;
	speedMultiplier: number;
	tickIntervalMs: number;
	activeGroupSize: number;
	symbolCount: number;
	agentCount: number;
	lastSummary: TickSummaryData | null;
}

export type SimulationSessionStatus =
	| "pending"
	| "active"
	| "suspended"
	| "completed"
	| "failed"
	| "deleting";

export interface SimulationSessionSummary {
	id: string;
	name: string;
	status: SimulationSessionStatus;
	symbols: string[];
	seed: number;
	agentCount: number;
	groupCount: number;
	activeGroupSize: number;
	tickIntervalMs: number;
	simulatedTickDuration: number;
	llmConcurrency: number;
	llmTimeoutMs: number;
	researchFrequency: number;
	alpacaDataTypes: string[];
	traderDistribution: TraderDistribution;
	currentTick: number;
	createdAt: Date | null;
	updatedAt: Date | null;
	startedAt: Date | null;
	endedAt: Date | null;
}

export interface SessionWatchlistEntry {
	lastBar: OHLCVBarData | null;
	snapshot: LOBSnapshotData | null;
}

export interface SessionDashboardHydration {
	session: SimulationSessionSummary;
	isLive: boolean;
	simState: SimRuntimeStateData | null;
	watchlist: Record<string, SessionWatchlistEntry>;
	researchNotes: ResearchNote[];
	agentRoster: SessionAgentRosterEntry[];
	agentEvents: AgentEvent[];
}

export interface SessionSymbolHydration {
	symbol: string;
	bars: OHLCVBarData[];
	snapshot: LOBSnapshotData | null;
	trades: TradeData[];
}

export interface SessionAgentPosition {
	qty: number;
	avgCost: number;
}

export interface SessionAgentRosterEntry {
	id: string;
	name: string;
	tier: AgentTier;
	status: AgentStatus;
	entityType: string;
	strategyType: string;
	currentCash: number;
	currentNav: number;
	positions: Record<string, SessionAgentPosition>;
	lastAutopilotDirective: AutopilotDirective | null;
	lastLlmAt: Date | null;
	llmGroup: number;
}

// ── World Events ──

export type WorldEventType =
	| "rate_decision"
	| "earnings"
	| "news"
	| "lawsuit"
	| "regulatory"
	| "macro"
	| "geopolitical"
	| "sector_rotation"
	| "custom";

export type WorldEventStatus = "queued" | "applied" | "rejected" | "observed";
export type WorldEventSource = "chatbot" | "synthetic" | "real_news";

export interface WorldEvent {
	id: string;
	type: WorldEventType;
	title: string;
	magnitude: number;
	affectedSymbols: string[];
	status: WorldEventStatus;
	source: WorldEventSource;
	requestedAtTick: number;
	appliedAtTick: number | null;
	payload: Record<string, unknown>;
}

// ── Command Payloads ──

export const injectWorldEventPayloadSchema = z.object({
	eventId: z.string().min(1).max(128).optional(),
	type: z.enum([
		"rate_decision",
		"earnings",
		"news",
		"lawsuit",
		"regulatory",
		"macro",
		"geopolitical",
		"sector_rotation",
		"custom",
	]),
	title: z.string().min(1).max(200),
	magnitude: z.number().min(-1).max(1),
	affectedSymbols: z.array(z.string().min(1)).min(1),
	source: z.enum(["chatbot", "synthetic", "real_news"]).default("chatbot"),
	payload: z.record(z.string(), z.unknown()).default({}),
});

export const startSimCommandPayloadSchema = z.object({});
export const pauseSimCommandPayloadSchema = z.object({});
export const stepSimCommandPayloadSchema = z.object({});
export const setSpeedCommandPayloadSchema = z.object({
	speedMultiplier: z.number().positive(),
});
export const setTickIntervalCommandPayloadSchema = z.object({
	tickIntervalMs: z.number().int().min(0),
});

export type InjectWorldEventCommand = z.infer<
	typeof injectWorldEventPayloadSchema
>;

export type SimCommandType =
	| "inject_world_event"
	| "start"
	| "pause"
	| "step"
	| "set_speed"
	| "set_tick_interval";

export const simCommandTypeSchema = z.enum([
	"inject_world_event",
	"start",
	"pause",
	"step",
	"set_speed",
	"set_tick_interval",
]);

export const simCommandPayloadSchemaByType = {
	inject_world_event: injectWorldEventPayloadSchema,
	start: startSimCommandPayloadSchema,
	pause: pauseSimCommandPayloadSchema,
	step: stepSimCommandPayloadSchema,
	set_speed: setSpeedCommandPayloadSchema,
	set_tick_interval: setTickIntervalCommandPayloadSchema,
} as const;

export interface ParsedSimCommand<
	TType extends SimCommandType = SimCommandType,
> {
	id: number;
	type: TType;
	payload: z.infer<(typeof simCommandPayloadSchemaByType)[TType]>;
}

export interface AgentSignal {
	agentId: string;
	agentName: string;
	side: "buy" | "sell";
	symbol: string;
	price: number;
	qty: number;
	reasoning: string | null;
	tick: number;
}

export type AgentFailureReason =
	| "schema_validation_failed"
	| "timeout"
	| "llm_error";

export interface AgentDecisionOrder {
	orderId: string;
	symbol: string;
	side: OrderSide;
	type: OrderType;
	qty: number;
	price: string;
	status: OrderStatus;
	filledQty: number;
	rejectionReason?: string;
}

interface AgentEventBase {
	eventId: string;
	agentId: string;
	agentName: string;
	tick: number;
}

export interface AgentRunStartedEvent extends AgentEventBase {
	type: "run_started";
}

export interface AgentThinkingDeltaEvent extends AgentEventBase {
	type: "thinking_delta";
	delta: string;
	transcript: string;
}

export interface AgentDecisionEvent extends AgentEventBase {
	type: "decision";
	decision: {
		reasoning: string;
		ordersPlaced: AgentDecisionOrder[];
		autopilotDirective: AutopilotDirective;
	};
}

export interface AgentSignalEvent extends AgentEventBase {
	type: "signal";
	signal: AgentSignal;
}

export interface AgentFailedEvent extends AgentEventBase {
	type: "failed";
	reason: AgentFailureReason;
	message: string;
	transcript: string;
	fallbackDirective: AutopilotDirective;
}

export type AgentEvent =
	| AgentRunStartedEvent
	| AgentThinkingDeltaEvent
	| AgentDecisionEvent
	| AgentSignalEvent
	| AgentFailedEvent;

export interface StagedOrderResult {
	order: Order;
	source: "autopilot" | "llm" | "market-maker-requote";
	agentName: string;
	reasoning: string | null;
}

export interface TickSummary {
	durationMs: number;
	orderCount: number;
	tradeCount: number;
	activeAgents: number;
	simTick: number;
	simulatedTime: Date;
	trades: Trade[];
	isRunning: boolean;
}

export interface SimOrchestratorState {
	isRunning: boolean;
	isTicking: boolean;
	simTick: number;
	simulatedTime: Date;
	activeGroupIndex: number;
	lastSummary: TickSummary | null;
}
