import Decimal from "decimal.js";
import { RequestContext } from "@mastra/core/request-context";
import { DEV_TICKERS, type Sector } from "#/lib/constants";
import type { ResearchRequestContextValues } from "#/mastra/research-context";
import type { TradingRequestContextValues } from "#/mastra/trading-context";
import type {
	AgentConfig,
	AgentState,
	AutopilotDirective,
} from "#/types/agent";
import { AgentRegistry } from "../AgentRegistry";
import type { ResearchAgentWorker } from "./types";
import { RESEARCH_AGENT_BLUEPRINTS } from "./constants";
import { deriveModelTier, deriveMaxInventoryPerName } from "./utils";

function buildDefaultDirective(config: AgentConfig): AutopilotDirective {
	const sectorSet = new Set(config.sectors);
	const matchingSymbols = DEV_TICKERS.filter((t) =>
		sectorSet.has(t.sector as Sector),
	).map((t) => t.symbol);

	const symbols =
		matchingSymbols.length > 0
			? matchingSymbols
			: DEV_TICKERS.slice(0, 2).map((t) => t.symbol);

	const side =
		config.strategy.includes("value") || config.strategy.includes("pension")
			? ("buy" as const)
			: config.strategy.includes("momentum")
				? config.id.charCodeAt(config.id.length - 1) % 2 === 0
					? ("buy" as const)
					: ("sell" as const)
				: config.id.charCodeAt(config.id.length - 1) % 2 === 0
					? ("buy" as const)
					: ("sell" as const);

	const standingOrders = symbols.slice(0, 2).map((symbol) => ({
		symbol,
		side,
		type: "limit" as const,
		price: side === "buy" ? 0 : Number.MAX_SAFE_INTEGER,
		qty: Math.max(1, Math.floor(5 + config.capital / 100000)),
	}));

	return {
		standingOrders,
		holdPositions: [],
	};
}

export function spawnAgents(
	configs: AgentConfig[],
	groupCount: number,
): AgentRegistry {
	if (groupCount <= 0) {
		throw new Error("groupCount must be greater than 0");
	}

	const registry = new AgentRegistry();

	for (const config of configs) {
		if (config.llmGroup < 0 || config.llmGroup >= groupCount) {
			throw new Error(
				`Agent ${config.id} has llmGroup=${config.llmGroup}, which is outside groupCount=${groupCount}`,
			);
		}

		const requestContext = new RequestContext<TradingRequestContextValues>();
		requestContext.set("agent-id", config.id);
		requestContext.set("agent-name", config.name);
		requestContext.set("entity-type", config.entityType);
		requestContext.set("tier", config.tier);
		requestContext.set("strategy", config.strategy);
		requestContext.set("persona", config.persona);
		requestContext.set("current-agenda", config.currentAgenda);
		requestContext.set("investment-thesis", config.investmentThesis);
		requestContext.set("quarterly-goal", config.quarterlyGoal);
		requestContext.set("personality-traits", [...config.personalityTraits]);
		requestContext.set("behavioral-biases", [...config.behavioralBiases]);
		requestContext.set("constraints", [...config.constraints]);
		requestContext.set("mandate-sectors", [...config.sectors]);
		requestContext.set("risk-tolerance", config.risk);
		requestContext.set("capital", config.capital);
		requestContext.set("model", config.model);
		requestContext.set("model-tier", deriveModelTier(config.model));
		requestContext.set("llm-group", config.llmGroup);
		requestContext.set("decision-params", { ...config.decisionParams });
		requestContext.set("restricted-symbols", [...config.restrictedSymbols]);

		if (typeof config.decisionParams.maxPositionPct === "number") {
			requestContext.set(
				"max-position-pct",
				config.decisionParams.maxPositionPct,
			);
		}

		const maxInventoryPerName = deriveMaxInventoryPerName(config);
		if (maxInventoryPerName !== undefined) {
			requestContext.set("max-inventory-per-name", maxInventoryPerName);
		}

		const state: AgentState = {
			id: config.id,
			name: config.name,
			tier: config.tier,
			status: "active",
			strategy: config.strategy,
			llmGroup: config.llmGroup,
			cash: new Decimal(config.capital),
			nav: new Decimal(config.capital),
			positions: new Map(),
			openOrders: new Map(),
			researchInbox: new Map(),
			lastAutopilotDirective: buildDefaultDirective(config),
			lastLlmTick: null,
			realizedPnl: new Map(),
			pendingFills: [],
		};

		registry.register({
			config,
			state,
			requestContext,
		});
	}

	return registry;
}

export function spawnResearchAgents(): ResearchAgentWorker[] {
	return RESEARCH_AGENT_BLUEPRINTS.map((blueprint) => {
		const requestContext = new RequestContext<ResearchRequestContextValues>();
		requestContext.set("agent-id", blueprint.id);
		requestContext.set("agent-name", blueprint.name);
		requestContext.set("research-focus", blueprint.focus);
		requestContext.set("sources", [...blueprint.sources]);
		requestContext.set("persona", blueprint.persona);

		return {
			...blueprint,
			requestContext,
		};
	});
}
