CREATE TYPE "public"."agent_status" AS ENUM('active', 'paused', 'liquidated');--> statement-breakpoint
CREATE TYPE "public"."agent_tier" AS ENUM('tier1', 'tier2', 'tier3', 'research', 'strategy');--> statement-breakpoint
CREATE TYPE "public"."command_status" AS ENUM('pending', 'processed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'open', 'partial', 'filled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('market', 'limit');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('bullish', 'bearish', 'neutral');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier" "agent_tier" NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"entity_type" text DEFAULT 'unknown' NOT NULL,
	"strategy_type" text NOT NULL,
	"model_id" text,
	"persona" text,
	"mandate_sectors" jsonb,
	"risk_tolerance" real DEFAULT 0.5 NOT NULL,
	"starting_capital" real DEFAULT 0 NOT NULL,
	"current_cash" real DEFAULT 0 NOT NULL,
	"current_nav" real DEFAULT 0 NOT NULL,
	"positions" jsonb DEFAULT '{}'::jsonb,
	"parameters" jsonb DEFAULT '{}'::jsonb,
	"last_autopilot_directive" jsonb,
	"last_llm_at" timestamp,
	"llm_group" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commands_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"payload" jsonb,
	"status" "command_status" DEFAULT 'pending' NOT NULL,
	"result_message" text,
	"created_at" timestamp DEFAULT now(),
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "divergence_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "divergence_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tick" integer NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"sim_price" real NOT NULL,
	"real_price" real NOT NULL,
	"divergence_pct" real NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tick" integer NOT NULL,
	"from_agent_id" varchar(128),
	"to_agent_id" varchar(128),
	"channel" text,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"tick" integer NOT NULL,
	"agent_id" varchar(128) NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"type" "order_type" NOT NULL,
	"side" "order_side" NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"price" real,
	"quantity" integer NOT NULL,
	"filled_quantity" integer DEFAULT 0 NOT NULL,
	"llm_reasoning" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "research_notes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "research_notes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tick" integer NOT NULL,
	"agent_id" varchar(128) NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"sentiment" "sentiment",
	"symbols" jsonb,
	"release_tick" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sim_config" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sim_config_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"is_running" boolean DEFAULT false NOT NULL,
	"current_tick" integer DEFAULT 0 NOT NULL,
	"simulated_market_time" timestamp,
	"speed_multiplier" real DEFAULT 1 NOT NULL,
	"tick_interval_ms" integer DEFAULT 0 NOT NULL,
	"seed" integer DEFAULT 42 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sim_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sim_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tick" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "symbols" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "symbols_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ticker" varchar(10) NOT NULL,
	"name" text NOT NULL,
	"sector" text,
	"eps" real,
	"pe" real,
	"market_cap" bigint,
	"last_price" real,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "symbols_ticker_unique" UNIQUE("ticker")
);
--> statement-breakpoint
CREATE TABLE "ticks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ticks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tick" integer NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"open" real NOT NULL,
	"high" real NOT NULL,
	"low" real NOT NULL,
	"close" real NOT NULL,
	"volume" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"tick" integer NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"buy_order_id" varchar(128) NOT NULL,
	"sell_order_id" varchar(128) NOT NULL,
	"buyer_agent_id" varchar(128) NOT NULL,
	"seller_agent_id" varchar(128) NOT NULL,
	"price" real NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "world_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "world_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_id" varchar(128) NOT NULL,
	"type" text DEFAULT 'custom' NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"magnitude" real DEFAULT 0 NOT NULL,
	"affected_symbols" jsonb DEFAULT '[]'::jsonb,
	"payload" jsonb,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp DEFAULT now(),
	"applied_at_tick" integer,
	"applied_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "world_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buy_order_id_orders_id_fk" FOREIGN KEY ("buy_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_sell_order_id_orders_id_fk" FOREIGN KEY ("sell_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyer_agent_id_agents_id_fk" FOREIGN KEY ("buyer_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_seller_agent_id_agents_id_fk" FOREIGN KEY ("seller_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_tier_idx" ON "agents" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "agents_llm_group_idx" ON "agents" USING btree ("llm_group");--> statement-breakpoint
CREATE INDEX "agents_status_idx" ON "agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "commands_status_idx" ON "commands" USING btree ("status");--> statement-breakpoint
CREATE INDEX "divergence_log_tick_idx" ON "divergence_log" USING btree ("tick");--> statement-breakpoint
CREATE INDEX "divergence_log_symbol_idx" ON "divergence_log" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "messages_tick_idx" ON "messages" USING btree ("tick");--> statement-breakpoint
CREATE INDEX "messages_from_agent_idx" ON "messages" USING btree ("from_agent_id");--> statement-breakpoint
CREATE INDEX "messages_to_agent_idx" ON "messages" USING btree ("to_agent_id");--> statement-breakpoint
CREATE INDEX "orders_tick_idx" ON "orders" USING btree ("tick");--> statement-breakpoint
CREATE INDEX "orders_agent_id_idx" ON "orders" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "orders_symbol_idx" ON "orders" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "research_notes_tick_idx" ON "research_notes" USING btree ("tick");--> statement-breakpoint
CREATE INDEX "research_notes_agent_id_idx" ON "research_notes" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "sim_snapshots_tick_idx" ON "sim_snapshots" USING btree ("tick");--> statement-breakpoint
CREATE INDEX "symbols_ticker_idx" ON "symbols" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "symbols_sector_idx" ON "symbols" USING btree ("sector");--> statement-breakpoint
CREATE INDEX "ticks_tick_idx" ON "ticks" USING btree ("tick");--> statement-breakpoint
CREATE INDEX "ticks_symbol_idx" ON "ticks" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "ticks_tick_symbol_idx" ON "ticks" USING btree ("tick","symbol");--> statement-breakpoint
CREATE INDEX "trades_tick_idx" ON "trades" USING btree ("tick");--> statement-breakpoint
CREATE INDEX "trades_symbol_idx" ON "trades" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "trades_buyer_idx" ON "trades" USING btree ("buyer_agent_id");--> statement-breakpoint
CREATE INDEX "trades_seller_idx" ON "trades" USING btree ("seller_agent_id");--> statement-breakpoint
CREATE INDEX "world_events_status_idx" ON "world_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "world_events_event_id_idx" ON "world_events" USING btree ("event_id");