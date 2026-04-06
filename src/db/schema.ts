import {
	pgTable,
	pgEnum,
	text,
	integer,
	boolean,
	real,
	timestamp,
	jsonb,
	index,
	uniqueIndex,
	bigint,
	varchar,
} from "drizzle-orm/pg-core";
import type { AgentEvent, TickSummary } from "#/types/sim";
import type { TraderDistribution } from "#/lib/simulation-session";

// ── Enums ──

export const agentTierEnum = pgEnum("agent_tier", [
	"tier1",
	"tier2",
	"tier3",
	"research",
	"strategy",
]);

export const agentStatusEnum = pgEnum("agent_status", [
	"active",
	"paused",
	"liquidated",
]);

export const orderTypeEnum = pgEnum("order_type", ["market", "limit"]);

export const orderSideEnum = pgEnum("order_side", ["buy", "sell"]);

export const orderStatusEnum = pgEnum("order_status", [
	"pending",
	"open",
	"partial",
	"filled",
	"cancelled",
]);

export const sentimentEnum = pgEnum("sentiment", [
	"bullish",
	"bearish",
	"neutral",
]);

export const commandStatusEnum = pgEnum("command_status", [
	"pending",
	"processed",
	"rejected",
]);

export const simulationSessionStatusEnum = pgEnum("simulation_session_status", [
	"pending",
	"active",
	"completed",
	"failed",
	"deleting",
]);

// ── Tables ──

export const simulationSessions = pgTable(
	"simulation_sessions",
	{
		id: varchar("id", { length: 128 }).primaryKey(),
		name: text("name").notNull(),
		status: simulationSessionStatusEnum("status").notNull().default("pending"),
		symbols: jsonb("symbols").$type<string[]>().notNull().default([]),
		seed: integer("seed").notNull().default(42),
		agentCount: integer("agent_count").notNull().default(50),
		groupCount: integer("group_count").notNull().default(10),
		activeGroupSize: integer("active_group_size").notNull().default(5),
		tickIntervalMs: integer("tick_interval_ms").notNull().default(1000),
		simulatedTickDuration: integer("simulated_tick_duration")
			.notNull()
			.default(5),
		llmConcurrency: integer("llm_concurrency").notNull().default(10),
		llmTimeoutMs: integer("llm_timeout_ms").notNull().default(15000),
		researchFrequency: integer("research_frequency").notNull().default(20),
		alpacaDataTypes: jsonb("alpaca_data_types")
			.$type<string[]>()
			.notNull()
			.default(["quotes", "bars"]),
		traderDistribution: jsonb("trader_distribution")
			.$type<TraderDistribution>()
			.notNull()
			.default({
				tier1: 2,
				hedgeFund: 3,
				marketMaker: 3,
				pension: 2,
				momentum: 15,
				value: 10,
				noise: 10,
				depthProvider: 5,
			}),
		startedAt: timestamp("started_at"),
		endedAt: timestamp("ended_at"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => [
		index("simulation_sessions_status_idx").on(table.status),
		index("simulation_sessions_updated_at_idx").on(table.updatedAt),
	],
);

export const simConfig = pgTable("sim_config", {
	id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
	sessionId: varchar("session_id", { length: 128 })
		.notNull()
		.references(() => simulationSessions.id, { onDelete: "cascade" })
		.unique(),
	isRunning: boolean("is_running").notNull().default(false),
	currentTick: integer("current_tick").notNull().default(0),
	simulatedMarketTime: timestamp("simulated_market_time"),
	speedMultiplier: real("speed_multiplier").notNull().default(1),
	tickIntervalMs: integer("tick_interval_ms").notNull().default(0),
	lastSummary: jsonb("last_summary").$type<TickSummary | null>(),
	seed: integer("seed").notNull().default(42),
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").defaultNow(),
});

export const agents = pgTable(
	"agents",
	{
		id: varchar("id", { length: 128 }).primaryKey(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		tier: agentTierEnum("tier").notNull(),
		status: agentStatusEnum("status").notNull().default("active"),
		entityType: text("entity_type").notNull().default("unknown"),
		strategyType: text("strategy_type").notNull(),
		modelId: text("model_id"),
		persona: text("persona"),
		mandateSectors: jsonb("mandate_sectors").$type<string[]>(),
		riskTolerance: real("risk_tolerance").notNull().default(0.5),
		startingCapital: real("starting_capital").notNull().default(0),
		currentCash: real("current_cash").notNull().default(0),
		currentNav: real("current_nav").notNull().default(0),
		positions: jsonb("positions")
			.$type<Record<string, { qty: number; avgCost: number }>>()
			.default({}),
		parameters: jsonb("parameters").$type<Record<string, number>>().default({}),
		realizedPnl: jsonb("realized_pnl")
			.$type<Record<string, number>>()
			.default({}),
		lastAutopilotDirective: jsonb("last_autopilot_directive"),
		lastLlmAt: timestamp("last_llm_at"),
		llmGroup: integer("llm_group").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		index("agents_session_id_idx").on(table.sessionId),
		index("agents_tier_idx").on(table.tier),
		index("agents_llm_group_idx").on(table.llmGroup),
		index("agents_status_idx").on(table.status),
	],
);

export const symbols = pgTable(
	"symbols",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		ticker: varchar("ticker", { length: 10 }).notNull().unique(),
		name: text("name").notNull(),
		sector: text("sector"),
		eps: real("eps"),
		pe: real("pe"),
		marketCap: bigint("market_cap", { mode: "number" }),
		lastPrice: real("last_price"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		index("symbols_ticker_idx").on(table.ticker),
		index("symbols_sector_idx").on(table.sector),
	],
);

export const orders = pgTable(
	"orders",
	{
		id: varchar("id", { length: 128 }).primaryKey(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		tick: integer("tick").notNull(),
		agentId: varchar("agent_id", { length: 128 })
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		symbol: varchar("symbol", { length: 10 }).notNull(),
		type: orderTypeEnum("type").notNull(),
		side: orderSideEnum("side").notNull(),
		status: orderStatusEnum("status").notNull().default("pending"),
		price: real("price"),
		quantity: integer("quantity").notNull(),
		filledQuantity: integer("filled_quantity").notNull().default(0),
		llmReasoning: text("llm_reasoning"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		index("orders_session_id_idx").on(table.sessionId),
		index("orders_tick_idx").on(table.tick),
		index("orders_agent_id_idx").on(table.agentId),
		index("orders_symbol_idx").on(table.symbol),
		index("orders_status_idx").on(table.status),
	],
);

export const trades = pgTable(
	"trades",
	{
		id: varchar("id", { length: 128 }).primaryKey(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		tick: integer("tick").notNull(),
		symbol: varchar("symbol", { length: 10 }).notNull(),
		buyOrderId: varchar("buy_order_id", { length: 128 })
			.notNull()
			.references(() => orders.id, { onDelete: "cascade" }),
		sellOrderId: varchar("sell_order_id", { length: 128 })
			.notNull()
			.references(() => orders.id, { onDelete: "cascade" }),
		buyerAgentId: varchar("buyer_agent_id", { length: 128 })
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		sellerAgentId: varchar("seller_agent_id", { length: 128 })
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		price: real("price").notNull(),
		quantity: integer("quantity").notNull(),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		index("trades_session_id_idx").on(table.sessionId),
		index("trades_tick_idx").on(table.tick),
		index("trades_symbol_idx").on(table.symbol),
		index("trades_buyer_idx").on(table.buyerAgentId),
		index("trades_seller_idx").on(table.sellerAgentId),
	],
);

export const ticks = pgTable(
	"ticks",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		tick: integer("tick").notNull(),
		symbol: varchar("symbol", { length: 10 }).notNull(),
		open: real("open").notNull(),
		high: real("high").notNull(),
		low: real("low").notNull(),
		close: real("close").notNull(),
		volume: integer("volume").notNull().default(0),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		index("ticks_session_id_idx").on(table.sessionId),
		index("ticks_tick_idx").on(table.tick),
		index("ticks_symbol_idx").on(table.symbol),
		index("ticks_tick_symbol_idx").on(table.tick, table.symbol),
	],
);

export const researchNotes = pgTable(
	"research_notes",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		noteId: varchar("note_id", { length: 128 }).notNull().unique(),
		publishedAtTick: integer("published_at_tick").notNull(),
		agentId: varchar("agent_id", { length: 128 })
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		focus: text("focus").notNull(),
		headline: text("headline").notNull(),
		body: text("body").notNull(),
		sentiment: sentimentEnum("sentiment").notNull(),
		confidence: real("confidence").notNull().default(0),
		symbols: jsonb("symbols").$type<string[]>().notNull().default([]),
		sources: jsonb("sources").$type<string[]>().notNull().default([]),
		releasedToTier: agentTierEnum("released_to_tier")
			.notNull()
			.default("research"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		index("research_notes_session_id_idx").on(table.sessionId),
		index("research_notes_tick_idx").on(table.publishedAtTick),
		index("research_notes_agent_id_idx").on(table.agentId),
	],
);

export const worldEvents = pgTable(
	"world_events",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		eventId: varchar("event_id", { length: 128 }).notNull().unique(),
		type: text("type").notNull().default("custom"),
		source: text("source").notNull(), // "chatbot" | "synthetic" | "news"
		title: text("title").notNull(),
		description: text("description").notNull(),
		magnitude: real("magnitude").notNull().default(0),
		affectedSymbols: jsonb("affected_symbols").$type<string[]>().default([]),
		payload: jsonb("payload"),
		status: varchar("status", { length: 20 }).notNull().default("queued"), // queued | applied | rejected | observed
		requestedAt: timestamp("requested_at").defaultNow(),
		appliedAtTick: integer("applied_at_tick"),
		appliedAt: timestamp("applied_at"),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		index("world_events_session_id_idx").on(table.sessionId),
		index("world_events_status_idx").on(table.status),
		index("world_events_event_id_idx").on(table.eventId),
	],
);

export const divergenceLog = pgTable(
	"divergence_log",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		tick: integer("tick").notNull(),
		symbol: varchar("symbol", { length: 10 }).notNull(),
		simPrice: real("sim_price").notNull(),
		realPrice: real("real_price").notNull(),
		divergencePct: real("divergence_pct").notNull(),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		index("divergence_log_session_id_idx").on(table.sessionId),
		index("divergence_log_tick_idx").on(table.tick),
		index("divergence_log_symbol_idx").on(table.symbol),
	],
);

export const commands = pgTable(
	"commands",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		payload: jsonb("payload"),
		status: commandStatusEnum("status").notNull().default("pending"),
		resultMessage: text("result_message"),
		createdAt: timestamp("created_at").defaultNow(),
		processedAt: timestamp("processed_at"),
	},
	(table) => [
		index("commands_session_id_idx").on(table.sessionId),
		index("commands_status_idx").on(table.status),
	],
);

export const agentEvents = pgTable(
	"agent_events",
	{
		eventId: varchar("event_id", { length: 128 }).primaryKey(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		agentId: varchar("agent_id", { length: 128 })
			.notNull()
			.references(() => agents.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		tick: integer("tick").notNull(),
		payload: jsonb("payload").$type<AgentEvent>().notNull(),
		createdAt: timestamp("created_at").defaultNow(),
	},
	(table) => [
		index("agent_events_session_id_idx").on(table.sessionId),
		index("agent_events_agent_id_idx").on(table.agentId),
		index("agent_events_tick_idx").on(table.tick),
	],
);

type PersistedOrderBookPriceLevel = {
	price: number;
	qty: number;
	orderCount: number;
};

export const orderBookSnapshots = pgTable(
	"order_book_snapshots",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		sessionId: varchar("session_id", { length: 128 })
			.notNull()
			.references(() => simulationSessions.id, { onDelete: "cascade" }),
		symbol: varchar("symbol", { length: 10 }).notNull(),
		tick: integer("tick").notNull().default(0),
		bids: jsonb("bids")
			.$type<PersistedOrderBookPriceLevel[]>()
			.notNull()
			.default([]),
		asks: jsonb("asks")
			.$type<PersistedOrderBookPriceLevel[]>()
			.notNull()
			.default([]),
		lastPrice: real("last_price"),
		spread: real("spread"),
		createdAt: timestamp("created_at").defaultNow(),
		updatedAt: timestamp("updated_at").defaultNow(),
	},
	(table) => [
		index("order_book_snapshots_session_id_idx").on(table.sessionId),
		index("order_book_snapshots_symbol_idx").on(table.symbol),
		uniqueIndex("order_book_snapshots_session_symbol_uidx").on(
			table.sessionId,
			table.symbol,
		),
	],
);
