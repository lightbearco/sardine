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
  bigint,
  varchar,
} from "drizzle-orm/pg-core";

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

// ── Tables ──

export const simConfig = pgTable("sim_config", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  isRunning: boolean("is_running").notNull().default(false),
  currentTick: integer("current_tick").notNull().default(0),
  simulatedMarketTime: timestamp("simulated_market_time"),
  speedMultiplier: real("speed_multiplier").notNull().default(1),
  tickIntervalMs: integer("tick_interval_ms").notNull().default(0),
  seed: integer("seed").notNull().default(42),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const agents = pgTable(
  "agents",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
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
    lastAutopilotDirective: jsonb("last_autopilot_directive"),
    lastLlmAt: timestamp("last_llm_at"),
    llmGroup: integer("llm_group").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("agents_tier_idx").on(table.tier),
    index("agents_llm_group_idx").on(table.llmGroup),
    index("agents_status_idx").on(table.status),
  ]
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
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    tick: integer("tick").notNull(),
    agentId: varchar("agent_id", { length: 128 })
      .notNull()
      .references(() => agents.id),
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
    index("orders_tick_idx").on(table.tick),
    index("orders_agent_id_idx").on(table.agentId),
    index("orders_symbol_idx").on(table.symbol),
    index("orders_status_idx").on(table.status),
  ]
);

export const trades = pgTable(
  "trades",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    tick: integer("tick").notNull(),
    symbol: varchar("symbol", { length: 10 }).notNull(),
    buyOrderId: varchar("buy_order_id", { length: 128 })
      .notNull()
      .references(() => orders.id),
    sellOrderId: varchar("sell_order_id", { length: 128 })
      .notNull()
      .references(() => orders.id),
    buyerAgentId: varchar("buyer_agent_id", { length: 128 })
      .notNull()
      .references(() => agents.id),
    sellerAgentId: varchar("seller_agent_id", { length: 128 })
      .notNull()
      .references(() => agents.id),
    price: real("price").notNull(),
    quantity: integer("quantity").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("trades_tick_idx").on(table.tick),
    index("trades_symbol_idx").on(table.symbol),
    index("trades_buyer_idx").on(table.buyerAgentId),
    index("trades_seller_idx").on(table.sellerAgentId),
  ]
);

export const ticks = pgTable(
  "ticks",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
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
    index("ticks_tick_idx").on(table.tick),
    index("ticks_symbol_idx").on(table.symbol),
    index("ticks_tick_symbol_idx").on(table.tick, table.symbol),
  ]
);

export const researchNotes = pgTable(
  "research_notes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    tick: integer("tick").notNull(),
    agentId: varchar("agent_id", { length: 128 })
      .notNull()
      .references(() => agents.id),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sentiment: sentimentEnum("sentiment"),
    symbols: jsonb("symbols").$type<string[]>(),
    releaseTick: integer("release_tick"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("research_notes_tick_idx").on(table.tick),
    index("research_notes_agent_id_idx").on(table.agentId),
  ]
);

export const worldEvents = pgTable(
  "world_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
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
    index("world_events_status_idx").on(table.status),
    index("world_events_event_id_idx").on(table.eventId),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    tick: integer("tick").notNull(),
    fromAgentId: varchar("from_agent_id", { length: 128 }).references(
      () => agents.id
    ),
    toAgentId: varchar("to_agent_id", { length: 128 }).references(
      () => agents.id
    ),
    channel: text("channel"),
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("messages_tick_idx").on(table.tick),
    index("messages_from_agent_idx").on(table.fromAgentId),
    index("messages_to_agent_idx").on(table.toAgentId),
  ]
);

export const simSnapshots = pgTable(
  "sim_snapshots",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    tick: integer("tick").notNull(),
    snapshot: jsonb("snapshot").notNull(), // full sim state
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("sim_snapshots_tick_idx").on(table.tick)]
);

export const divergenceLog = pgTable(
  "divergence_log",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    tick: integer("tick").notNull(),
    symbol: varchar("symbol", { length: 10 }).notNull(),
    simPrice: real("sim_price").notNull(),
    realPrice: real("real_price").notNull(),
    divergencePct: real("divergence_pct").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("divergence_log_tick_idx").on(table.tick),
    index("divergence_log_symbol_idx").on(table.symbol),
  ]
);

export const commands = pgTable(
  "commands",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    status: commandStatusEnum("status").notNull().default("pending"),
    resultMessage: text("result_message"),
    createdAt: timestamp("created_at").defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (table) => [index("commands_status_idx").on(table.status)]
);
