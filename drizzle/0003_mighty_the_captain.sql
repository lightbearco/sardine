CREATE TABLE "agent_events" (
	"event_id" varchar(128) PRIMARY KEY NOT NULL,
	"session_id" varchar(128) NOT NULL,
	"agent_id" varchar(128) NOT NULL,
	"type" text NOT NULL,
	"tick" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "sim_config" ADD COLUMN "last_summary" jsonb;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_session_id_simulation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."simulation_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_session_id_idx" ON "agent_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "agent_events_agent_id_idx" ON "agent_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_events_tick_idx" ON "agent_events" USING btree ("tick");