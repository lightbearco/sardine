import { RequestContext } from "@mastra/core/request-context";
import { isValidationError, type ValidationError } from "@mastra/core/tools";
import Decimal from "decimal.js";
import { AgentRegistry } from "#/agents/AgentRegistry";
import { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { TRADING_MODEL } from "#/mastra/models";
import type { TradingRequestContextValues } from "#/mastra/trading-context";
import type { AgentConfig, AgentState, Position } from "#/types/agent";
import type { Order } from "#/types/market";

type HarnessOptions = {
	configOverrides?: Partial<AgentConfig>;
	stateOverrides?: Partial<AgentState>;
	positions?: Record<string, Position>;
	openOrders?: Order[];
	symbols?: string[];
	simTick?: number;
	seedBooks?: boolean;
};

export function makeTestConfig(
	overrides: Partial<AgentConfig> = {},
): AgentConfig {
	return {
		id: "agent-1",
		name: "Agent 1",
		tier: "tier2",
		entityType: "hedge-fund",
		strategy: "value",
		persona: "You are a careful but opportunistic trader.",
		currentAgenda: "Add to quality names on weakness.",
		investmentThesis: "Quality dislocations should mean-revert over time.",
		quarterlyGoal: "Outperform carefully without oversized drawdowns.",
		personalityTraits: ["patient", "risk-aware"],
		behavioralBiases: ["anchoring"],
		constraints: ["Keep size disciplined."],
		restrictedSymbols: [],
		sectors: ["Technology"],
		risk: 0.4,
		capital: 100_000,
		model: TRADING_MODEL,
		llmGroup: 0,
		decisionParams: {
			maxPositionPct: 0.2,
		},
		...overrides,
	};
}

export function createToolHarness(options: HarnessOptions = {}) {
	const config = makeTestConfig(options.configOverrides);
	const openOrders = new Map(
		(options.openOrders ?? []).map((order) => [order.id, order]),
	);
	const positions = new Map(Object.entries(options.positions ?? {}));

	const state: AgentState = {
		id: config.id,
		name: config.name,
		tier: config.tier,
		status: "active",
		strategy: config.strategy,
		llmGroup: config.llmGroup,
		cash: new Decimal(config.capital),
		nav: new Decimal(config.capital),
		positions,
		openOrders,
		researchInbox: new Map(),
		lastAutopilotDirective: null,
		lastLlmTick: null,
		realizedPnl: new Map(),
		pendingFills: [],
		...options.stateOverrides,
	};

	const registry = new AgentRegistry();
	const storedRequestContext =
		new RequestContext<TradingRequestContextValues>();
	storedRequestContext.set("agent-id", config.id);
	storedRequestContext.set("agent-name", config.name);
	storedRequestContext.set("entity-type", config.entityType);
	storedRequestContext.set("tier", config.tier);
	storedRequestContext.set("strategy", config.strategy);
	storedRequestContext.set("persona", config.persona);
	storedRequestContext.set("current-agenda", config.currentAgenda);
	storedRequestContext.set("investment-thesis", config.investmentThesis);
	storedRequestContext.set("quarterly-goal", config.quarterlyGoal);
	storedRequestContext.set("personality-traits", [...config.personalityTraits]);
	storedRequestContext.set("behavioral-biases", [...config.behavioralBiases]);
	storedRequestContext.set("constraints", [...config.constraints]);
	storedRequestContext.set("mandate-sectors", [...config.sectors]);
	storedRequestContext.set("risk-tolerance", config.risk);
	storedRequestContext.set("capital", config.capital);
	storedRequestContext.set("model", config.model);
	storedRequestContext.set(
		"model-tier",
		String(config.model).includes("pro") ? "sonnet" : "haiku",
	);
	storedRequestContext.set("llm-group", config.llmGroup);
	storedRequestContext.set("decision-params", { ...config.decisionParams });
	storedRequestContext.set("restricted-symbols", [...config.restrictedSymbols]);

	if (typeof config.decisionParams.maxPositionPct === "number") {
		storedRequestContext.set(
			"max-position-pct",
			config.decisionParams.maxPositionPct,
		);
	}

	if (typeof config.decisionParams.maxInventoryPerName === "number") {
		storedRequestContext.set(
			"max-inventory-per-name",
			config.decisionParams.maxInventoryPerName,
		);
	}

	if (typeof config.decisionParams.inventoryTolerance === "number") {
		storedRequestContext.set(
			"max-inventory-per-name",
			Number(
				(config.capital * config.decisionParams.inventoryTolerance).toFixed(2),
			),
		);
	}

	registry.register({
		config,
		state,
		requestContext: storedRequestContext,
	});

	const engine = new MatchingEngine();
	const symbols = options.symbols ?? ["AAPL"];
	engine.initialize(symbols);

	if (options.seedBooks !== false) {
		for (const symbol of symbols) {
			engine.seedBook(symbol, new Decimal(100), new Decimal("0.10"), 3, 50, 0);
		}
	}

	const requestContext = new RequestContext<TradingRequestContextValues>(
		Array.from(storedRequestContext.entries()),
	);
	requestContext.set("agent-registry", registry);
	requestContext.set("matching-engine", engine);
	requestContext.set("sim-tick", options.simTick ?? 1);

	return {
		config,
		state,
		registry,
		engine,
		requestContext,
	};
}

export function unwrapToolResult<T>(
	result: T | ValidationError | undefined,
): T {
	if (result === undefined) {
		throw new Error("Tool returned no result");
	}

	if (isValidationError(result)) {
		throw new Error(`Tool validation failed: ${result.message}`);
	}

	return result;
}
