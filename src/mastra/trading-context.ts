import { RequestContext } from "@mastra/core/request-context";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { AgentRegistry } from "#/agents/AgentRegistry";
import type { MatchingEngine } from "#/engine/lob/MatchingEngine";
import type { AgentTier } from "#/types/agent";
import type { ResearchNote } from "#/types/research";

export type TradingModelTier = "sonnet" | "haiku";

export type TradingRequestContextValues = {
	"agent-id": string;
	"agent-name": string;
	"simulation-session-id"?: string;
	"entity-type": string;
	tier: AgentTier;
	strategy: string;
	persona: string;
	"current-agenda": string;
	"investment-thesis": string;
	"quarterly-goal": string;
	"personality-traits": string[];
	"behavioral-biases": string[];
	constraints: string[];
	"mandate-sectors": string[];
	"risk-tolerance": number;
	capital: number;
	model: MastraModelConfig;
	"model-tier": TradingModelTier;
	"llm-group": number;
	"decision-params": Record<string, number>;
	"max-position-pct"?: number;
	"max-inventory-per-name"?: number;
	"restricted-symbols"?: string[];
	"released-research-notes"?: ResearchNote[];
	"matching-engine"?: MatchingEngine;
	"agent-registry"?: AgentRegistry;
	"sim-tick"?: number;
};

export function cloneTradingRequestContext(
	requestContext: RequestContext<TradingRequestContextValues>,
): RequestContext<TradingRequestContextValues> {
	return new RequestContext<TradingRequestContextValues>(
		Array.from(requestContext.entries()),
	);
}
