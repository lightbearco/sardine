ALTER TABLE "simulation_sessions" ADD COLUMN "active_group_size" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "llm_concurrency" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "llm_timeout_ms" integer DEFAULT 15000 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "research_frequency" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "alpaca_data_types" jsonb DEFAULT '["quotes","bars"]'::jsonb NOT NULL;