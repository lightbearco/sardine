import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import {
	CloudExporter,
	DefaultExporter,
	Observability,
	SensitiveDataFilter,
} from "@mastra/observability";
import { researchAgent } from "#/mastra/agents/research-agent";
import { tradingAgent } from "#/mastra/agents/trading-agent";
import { pgVector } from "#/mastra/stores/pgvector";
import { postgresStore } from "./stores/postgres";

export const mastra = new Mastra({
	agents: { tradingAgent, researchAgent },
	storage: postgresStore,
	vectors: {
		pgVector,
	},
	logger: new PinoLogger({
		name: "Mastra",
		level: "info",
	}),
	observability: new Observability({
		configs: {
			default: {
				serviceName: "mastra",
				exporters: [
					new DefaultExporter(), // Persists traces to storage for Mastra Studio
					new CloudExporter(), // Sends traces to Mastra Cloud (if MASTRA_CLOUD_ACCESS_TOKEN is set)
				],
				spanOutputProcessors: [
					new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
				],
			},
		},
	}),
});
