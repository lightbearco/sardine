import { Mastra } from "@mastra/core/mastra";
import { MastraLogger } from "@mastra/core/logger";
import {
	CloudExporter,
	DefaultExporter,
	Observability,
	SensitiveDataFilter,
} from "@mastra/observability";
import { createLogger } from "#/lib/logger";
import { researchAgent } from "#/mastra/agents/research-agent";
import { tradingAgent } from "#/mastra/agents/trading-agent";
import { pgVector } from "#/mastra/stores/pgvector";
import { postgresStore } from "./stores/postgres";

const pinoLog = createLogger("Mastra");

class MastraPinoLogger extends MastraLogger {
	debug(message: string, ...args: any[]): void {
		pinoLog.debug({ mastra: args }, message);
	}
	info(message: string, ...args: any[]): void {
		pinoLog.info({ mastra: args }, message);
	}
	warn(message: string, ...args: any[]): void {
		pinoLog.warn({ mastra: args }, message);
	}
	error(message: string, ...args: any[]): void {
		pinoLog.error({ mastra: args }, message);
	}
}

export const mastra = new Mastra({
	agents: { tradingAgent, researchAgent },
	storage: postgresStore,
	vectors: {
		pgVector,
	},
	logger: new MastraPinoLogger({ name: "Mastra", level: "info" }),
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
