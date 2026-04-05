import { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { AgentRegistry } from "#/agents/AgentRegistry";
import { executeAutopilot } from "#/agents/autopilot";
import { generateAgentConfigs, spawnAgents } from "#/agents/factory";
import { PortfolioManager } from "#/agents/PortfolioManager";
import { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SIM_DEFAULTS } from "#/lib/constants";
import { marketDataTool } from "#/mastra/tools/marketDataTool";
import { orderTool } from "#/mastra/tools/orderTool";
import { portfolioTool } from "#/mastra/tools/portfolioTool";
import { unwrapToolResult } from "#/mastra/tools/__tests__/test-helpers";
import {
	cloneTradingRequestContext,
	type TradingRequestContextValues,
} from "#/mastra/trading-context";
import { TRADING_MODEL } from "#/mastra/models";
import type {
	AgentConfig,
	AgentState,
	AutopilotDirective,
} from "#/types/agent";
import type { Order } from "#/types/market";

function registerCounterparty(
	registry: AgentRegistry,
	overrides: Partial<AgentConfig> = {},
	stateOverrides: Partial<AgentState> = {},
) {
	const config: AgentConfig = {
		id: "agent-2",
		name: "Agent 2",
		tier: "tier2",
		entityType: "hedge-fund",
		strategy: "value",
		persona: "You are a liquidity-providing counterparty.",
		currentAgenda: "Provide liquidity around fair value.",
		investmentThesis: "Mean reversion keeps order flow two-sided.",
		quarterlyGoal: "Collect spread income without outsized inventory.",
		personalityTraits: ["patient"],
		behavioralBiases: ["anchoring"],
		constraints: ["Stay close to fair value."],
		restrictedSymbols: [],
		sectors: ["Technology"],
		risk: 0.3,
		capital: 100_000,
		model: TRADING_MODEL,
		llmGroup: 0,
		decisionParams: {},
		...overrides,
	};

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
		lastAutopilotDirective: null,
		lastLlmTick: null,
		...stateOverrides,
	};

	const requestContext = new RequestContext<TradingRequestContextValues>();
	requestContext.set("agent-id", config.id);
	requestContext.set("capital", config.capital);

	registry.register({
		config,
		state,
		requestContext,
	});
}

function createRestingOrder(overrides: Partial<Order> = {}): Order {
	return {
		id: "counterparty-order",
		symbol: "AAPL",
		side: "sell",
		type: "limit",
		price: new Decimal("100"),
		qty: 10,
		filledQty: 0,
		status: "pending",
		agentId: "agent-2",
		createdAtTick: 1,
		...overrides,
	};
}

describe("trading agent deterministic integration", () => {
	it("supports a local decision loop of market data, portfolio read, staged order submit, and portfolio read", async () => {
		const configs = generateAgentConfigs(42, 1);
		const registry = spawnAgents(configs, SIM_DEFAULTS.groupCount);
		const entry = registry.get(configs[0].id);

		expect(entry).toBeDefined();

		const requestContext = cloneTradingRequestContext(
			entry!.requestContext as RequestContext<TradingRequestContextValues>,
		);
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		engine.seedBook("AAPL", new Decimal(100), new Decimal("0.10"), 3, 50, 0);
		requestContext.set("matching-engine", engine);
		requestContext.set("agent-registry", registry);
		requestContext.set("sim-tick", 1);

		const beforeMarket = unwrapToolResult(
			await marketDataTool.execute?.(
				{ symbol: "AAPL" },
				{ requestContext },
			),
		);
		const beforePortfolio = unwrapToolResult(
			await portfolioTool.execute?.(
				{},
				{ requestContext },
			),
		);
		const order = unwrapToolResult(
			await orderTool.execute?.(
				{
					side: "buy",
					type: "limit",
				symbol: "AAPL",
				price: 99,
				qty: 10,
			},
				{ requestContext },
			),
		);
		const afterPortfolio = unwrapToolResult(
			await portfolioTool.execute?.(
				{},
				{ requestContext },
			),
		);

		expect(beforeMarket.symbol).toBe("AAPL");
		expect(beforePortfolio.positions).toEqual([]);
		expect(order.status).toBe("pending");
		expect(order.trades).toEqual([]);
		expect(afterPortfolio.openOrders).toEqual([]);
	});

	it("reconciles a filled sell-down and exposes the updated position through portfolioTool", async () => {
		const configs = generateAgentConfigs(42, 1);
		const registry = spawnAgents(configs, SIM_DEFAULTS.groupCount);
		const entry = registry.get(configs[0].id);

		expect(entry).toBeDefined();

		entry!.state.positions.set("AAPL", {
			qty: 10,
			avgCost: new Decimal("95"),
		});
		entry!.state.cash = new Decimal("99050");
		entry!.state.nav = new Decimal("100050");

		registerCounterparty(
			registry,
			{},
			{
				positions: new Map([
					[
						"AAPL",
						{
							qty: 20,
							avgCost: new Decimal("100"),
						},
					],
				]),
			},
		);

		const requestContext = cloneTradingRequestContext(
			entry!.requestContext as RequestContext<TradingRequestContextValues>,
		);
		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		engine.processOrder(
			createRestingOrder({
				side: "buy",
				price: new Decimal("101"),
				qty: 6,
			}),
			1,
		);
		requestContext.set("matching-engine", engine);
		requestContext.set("agent-registry", registry);
		requestContext.set("sim-tick", 2);

		const order = unwrapToolResult(
			await orderTool.execute?.(
				{
					side: "sell",
					type: "market",
					symbol: "AAPL",
					qty: 6,
				},
				{ requestContext },
			),
		);

		const trades = engine.processOrders(
			[
				{
					id: order.orderId,
					symbol: order.symbol,
					side: order.side,
					type: order.type,
					price: new Decimal(order.price),
					qty: order.qty,
					filledQty: 0,
					status: "pending",
					agentId: entry!.config.id,
					createdAtTick: 2,
				},
			],
			2,
		);

		const portfolioManager = new PortfolioManager();
		portfolioManager.reconcile(
			trades,
			registry,
			new Map([["AAPL", new Decimal("101")]]),
		);

		const portfolio = unwrapToolResult(
			await portfolioTool.execute?.({}, { requestContext }),
		);

		expect(order.status).toBe("pending");
		expect(portfolio.positions).toEqual([
			{
				symbol: "AAPL",
				qty: 4,
				avgCost: "95",
				markPrice: "101",
				marketValue: "404",
				unrealizedPnl: "24",
			},
		]);
		expect(portfolio.openOrders).toEqual([]);
	});

	it("bridges autopilot standing orders into tool-visible portfolio state", async () => {
		const configs = generateAgentConfigs(42, 1);
		const registry = spawnAgents(configs, SIM_DEFAULTS.groupCount);
		const entry = registry.get(configs[0].id);

		expect(entry).toBeDefined();

		entry!.state.positions.set("AAPL", {
			qty: 10,
			avgCost: new Decimal("90"),
		});
		entry!.state.cash = new Decimal("99100");
		entry!.state.nav = new Decimal("100100");
		entry!.state.lastAutopilotDirective = {
			standingOrders: [
				{
					symbol: "AAPL",
					side: "sell",
					type: "market",
					qty: 4,
				},
			],
			holdPositions: ["AAPL"],
		} satisfies AutopilotDirective;

		registerCounterparty(
			registry,
			{},
			{
				positions: new Map([
					[
						"AAPL",
						{
							qty: 20,
							avgCost: new Decimal("99"),
						},
					],
				]),
			},
		);

		const engine = new MatchingEngine();
		engine.initialize(["AAPL"]);
		engine.processOrder(
			createRestingOrder({
				side: "buy",
				price: new Decimal("100"),
				qty: 4,
			}),
			1,
		);

		const autopilotResult = executeAutopilot(
			entry!.state,
			new Map([["AAPL", 100]]),
			3,
		);
		const trades = engine.processOrders(autopilotResult.orders, 3);

		const portfolioManager = new PortfolioManager();
		portfolioManager.reconcile(
			trades,
			registry,
			new Map([["AAPL", new Decimal("100")]]),
		);

		const requestContext = cloneTradingRequestContext(
			entry!.requestContext as RequestContext<TradingRequestContextValues>,
		);
		requestContext.set("matching-engine", engine);
		requestContext.set("agent-registry", registry);
		requestContext.set("sim-tick", 3);

		const portfolio = unwrapToolResult(
			await portfolioTool.execute?.({}, { requestContext }),
		);

		expect(autopilotResult.orders).toHaveLength(1);
		expect(autopilotResult.urgentReview).toBe(false);
		expect(portfolio.positions).toEqual([
			{
				symbol: "AAPL",
				qty: 6,
				avgCost: "90",
				markPrice: "100",
				marketValue: "600",
				unrealizedPnl: "60",
			},
		]);
	});
});
