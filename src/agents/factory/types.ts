import type { RequestContext } from "@mastra/core/request-context";
import type { ResearchRequestContextValues } from "#/mastra/research-context";
import type { TradingModelTier } from "#/mastra/trading-context";
import type { AgentConfig } from "#/types/agent";
import type { ResearchFocus } from "#/types/research";

export type Category =
	| "hedge-fund"
	| "market-maker"
	| "pension"
	| "momentum"
	| "value"
	| "noise"
	| "depth-provider";

export type DistributionCategory =
	| "tier1"
	| "hedgeFund"
	| "marketMaker"
	| "pension"
	| "momentum"
	| "value"
	| "noise"
	| "depthProvider";

export type AgentSeedConfig = Omit<AgentConfig, "llmGroup">;

export interface ResearchAgentWorker {
	id: string;
	name: string;
	focus: ResearchFocus;
	persona: string;
	sources: string[];
	requestContext: RequestContext<ResearchRequestContextValues>;
}

export type { TradingModelTier };
