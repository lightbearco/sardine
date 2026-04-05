DO $$
BEGIN
	ALTER TYPE "public"."simulation_session_status" ADD VALUE 'deleting';
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "messages" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "sim_snapshots" CASCADE;
--> statement-breakpoint
DELETE FROM "divergence_log";
--> statement-breakpoint
ALTER TABLE "divergence_log" ADD COLUMN "session_id" varchar(128);
--> statement-breakpoint
ALTER TABLE "divergence_log" ALTER COLUMN "session_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "sim_config" DROP CONSTRAINT IF EXISTS "sim_config_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT IF EXISTS "trades_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT IF EXISTS "trades_buy_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT IF EXISTS "trades_sell_order_id_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT IF EXISTS "trades_buyer_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "trades" DROP CONSTRAINT IF EXISTS "trades_seller_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "ticks" DROP CONSTRAINT IF EXISTS "ticks_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "research_notes" DROP CONSTRAINT IF EXISTS "research_notes_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "research_notes" DROP CONSTRAINT IF EXISTS "research_notes_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "world_events" DROP CONSTRAINT IF EXISTS "world_events_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "commands" DROP CONSTRAINT IF EXISTS "commands_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_events" DROP CONSTRAINT IF EXISTS "agent_events_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_events" DROP CONSTRAINT IF EXISTS "agent_events_agent_id_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "order_book_snapshots" DROP CONSTRAINT IF EXISTS "order_book_snapshots_session_id_simulation_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "divergence_log" ADD CONSTRAINT "divergence_log_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sim_config" ADD CONSTRAINT "sim_config_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buy_order_id_orders_id_fk" FOREIGN KEY ("buy_order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_sell_order_id_orders_id_fk" FOREIGN KEY ("sell_order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_buyer_agent_id_agents_id_fk" FOREIGN KEY ("buyer_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_seller_agent_id_agents_id_fk" FOREIGN KEY ("seller_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticks" ADD CONSTRAINT "ticks_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "world_events" ADD CONSTRAINT "world_events_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_book_snapshots" ADD CONSTRAINT "order_book_snapshots_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "divergence_log_session_id_idx" ON "divergence_log" USING btree ("session_id");
