ALTER TYPE "public"."simulation_session_status" ADD VALUE 'deleting';--> statement-breakpoint
ALTER TABLE "messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sim_snapshots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "messages" CASCADE;--> statement-breakpoint
DROP TABLE "sim_snapshots" CASCADE;--> statement-breakpoint
ALTER TABLE "agent_events" DROP CONSTRAINT "agent_events_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_events" DROP CONSTRAINT "agent_events_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "commands" DROP CONSTRAINT "commands_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "order_book_snapshots" DROP CONSTRAINT "order_book_snapshots_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "research_notes" DROP CONSTRAINT "research_notes_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "research_notes" DROP CONSTRAINT "research_notes_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "sim_config" DROP CONSTRAINT "sim_config_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "ticks" DROP CONSTRAINT "ticks_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_buy_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_sell_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_buyer_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT "trades_seller_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "world_events" DROP CONSTRAINT "world_events_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "divergence_log" ADD COLUMN "session_id" varchar(128) NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "agent_count" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "group_count" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "tick_interval_ms" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "simulated_tick_duration" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "trader_distribution" jsonb DEFAULT '{"tier1":2,"hedgeFund":3,"marketMaker":3,"pension":2,"momentum":15,"value":10,"noise":10,"depthProvider":5}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergence_log" ADD CONSTRAINT "divergence_log_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_book_snapshots" ADD CONSTRAINT "order_book_snapshots_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_config" ADD CONSTRAINT "sim_config_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticks" ADD CONSTRAINT "ticks_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buy_order_id_orders_id_fk" FOREIGN KEY ("buy_order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_sell_order_id_orders_id_fk" FOREIGN KEY ("sell_order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyer_agent_id_agents_id_fk" FOREIGN KEY ("buyer_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_seller_agent_id_agents_id_fk" FOREIGN KEY ("seller_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_events" ADD CONSTRAINT "world_events_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "divergence_log_session_id_idx" ON "divergence_log" USING btree ("session_id");