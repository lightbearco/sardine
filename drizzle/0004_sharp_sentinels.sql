ALTER TABLE "simulation_sessions" ADD COLUMN "agent_count" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "group_count" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "tick_interval_ms" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "simulated_tick_duration" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "simulation_sessions" ADD COLUMN "trader_distribution" jsonb DEFAULT '{"tier1":2,"hedgeFund":3,"marketMaker":3,"pension":2,"momentum":15,"value":10,"noise":10,"depthProvider":5}'::jsonb NOT NULL;
