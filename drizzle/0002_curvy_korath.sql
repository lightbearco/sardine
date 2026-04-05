CREATE TYPE "public"."simulation_session_status" AS ENUM('pending', 'active', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "order_book_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "order_book_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" varchar(128) NOT NULL,
	"symbol" varchar(10) NOT NULL,
	"tick" integer DEFAULT 0 NOT NULL,
	"bids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"asks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_price" real,
	"spread" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "simulation_sessions" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "simulation_session_status" DEFAULT 'pending' NOT NULL,
	"symbols" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seed" integer DEFAULT 42 NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "simulation_sessions" ("id", "name", "status", "symbols", "seed", "started_at", "ended_at", "created_at", "updated_at")
VALUES ('legacy-session', 'Legacy Simulation', 'completed', '[]'::jsonb, 42, now(), now(), now(), now());--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "session_id" varchar(128) NOT NULL DEFAULT 'legacy-session';--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "session_id" varchar(128) NOT NULL DEFAULT 'legacy-session';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "session_id" varchar(128) NOT NULL DEFAULT 'legacy-session';--> statement-breakpoint
ALTER TABLE "research_notes" ADD COLUMN "session_id" varchar(128) NOT NULL DEFAULT 'legacy-session';--> statement-breakpoint
ALTER TABLE "sim_config" ADD COLUMN "session_id" varchar(128) NOT NULL DEFAULT 'legacy-session';--> statement-breakpoint
ALTER TABLE "ticks" ADD COLUMN "session_id" varchar(128) NOT NULL DEFAULT 'legacy-session';--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "session_id" varchar(128) NOT NULL DEFAULT 'legacy-session';--> statement-breakpoint
ALTER TABLE "world_events" ADD COLUMN "session_id" varchar(128) NOT NULL DEFAULT 'legacy-session';--> statement-breakpoint
ALTER TABLE "order_book_snapshots" ADD CONSTRAINT "order_book_snapshots_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_book_snapshots_session_id_idx" ON "order_book_snapshots" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "order_book_snapshots_symbol_idx" ON "order_book_snapshots" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "order_book_snapshots_session_symbol_uidx" ON "order_book_snapshots" USING btree ("session_id","symbol");--> statement-breakpoint
CREATE INDEX "simulation_sessions_status_idx" ON "simulation_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "simulation_sessions_updated_at_idx" ON "simulation_sessions" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commands" ADD CONSTRAINT "commands_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_config" ADD CONSTRAINT "sim_config_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticks" ADD CONSTRAINT "ticks_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_events" ADD CONSTRAINT "world_events_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_session_id_idx" ON "agents" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "commands_session_id_idx" ON "commands" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "orders_session_id_idx" ON "orders" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "research_notes_session_id_idx" ON "research_notes" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "ticks_session_id_idx" ON "ticks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "trades_session_id_idx" ON "trades" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "world_events_session_id_idx" ON "world_events" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "sim_config" ADD CONSTRAINT "sim_config_session_id_unique" UNIQUE("session_id");
