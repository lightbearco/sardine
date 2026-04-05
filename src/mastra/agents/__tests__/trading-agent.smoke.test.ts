import { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { generateAgentConfigs, spawnAgents } from "#/agents/factory";
import { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SIM_DEFAULTS } from "#/lib/constants";
import {
	tradingAgent,
	tradingDecisionSchema,
} from "#/mastra/agents/trading-agent";
import { TRADING_MODEL } from "#/mastra/models";
import {
	cloneTradingRequestContext,
	type TradingRequestContextValues,
} from "#/mastra/trading-context";

function logTradingDecision(result: {
	reasoningText?: string;
	object: {
		reasoning: string;
		ordersPlaced: unknown[];
		autopilotDirective: unknown;
	};
}) {
	console.log(
		`\n[live-trading-model] Agent reasoning:\n${result.object.reasoning}`,
	);

	if (result.reasoningText) {
		console.log(
			`\n[live-trading-model] Model reasoning text:\n${result.reasoningText}`,
		);
	}

	console.log(
		`\n[live-trading-model] Orders placed:\n${JSON.stringify(result.object.ordersPlaced, null, 2)}`,
	);
	console.log(
		`\n[live-trading-model] Autopilot directive:\n${JSON.stringify(result.object.autopilotDirective, null, 2)}`,
	);
}

const hasLiveTradingModelCredentials =
	process.env.RUN_LIVE_TRADING_MODEL_SMOKE === "true";

describe("tradingAgent smoke", () => {
	it.skipIf(!hasLiveTradingModelCredentials)(
		"produces a structured trading decision with a real trading model",
		async () => {
			const configs = generateAgentConfigs(42, 1);
			const registry = spawnAgents(configs, SIM_DEFAULTS.groupCount);
			const entry = registry.get(configs[0].id);

			expect(entry).toBeDefined();

			const engine = new MatchingEngine();
			engine.initialize(["AAPL"]);
			engine.seedBook("AAPL", new Decimal(100), new Decimal("0.10"), 3, 50, 0);

			const requestContext = cloneTradingRequestContext(
				entry!.requestContext as RequestContext<TradingRequestContextValues>,
			);
			requestContext.set("agent-registry", registry);
			requestContext.set("matching-engine", engine);
			requestContext.set("sim-tick", 1);

			const result = await tradingAgent.generate("What do you want to trade?", {
				requestContext,
				maxSteps: 6,
				structuredOutput: {
					schema: tradingDecisionSchema,
					model: TRADING_MODEL,
				},
			});

			logTradingDecision(result);

			expect(tradingDecisionSchema.parse(result.object)).toBeDefined();
			expect(result.object.reasoning.length).toBeGreaterThan(0);
		},
		60_000,
	);
});
