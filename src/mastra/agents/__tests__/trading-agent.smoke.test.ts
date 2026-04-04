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
import {
	getGoogleGeminiProvider,
	hasGoogleGenerativeAIEnv,
} from "#/mastra/google-gemini";
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
	console.log(`\n[live-gemini] Agent reasoning:\n${result.object.reasoning}`);

	if (result.reasoningText) {
		console.log(`\n[live-gemini] Model reasoning text:\n${result.reasoningText}`);
	}

	console.log(
		`\n[live-gemini] Orders placed:\n${JSON.stringify(result.object.ordersPlaced, null, 2)}`,
	);
	console.log(
		`\n[live-gemini] Autopilot directive:\n${JSON.stringify(result.object.autopilotDirective, null, 2)}`,
	);
}

const hasGoogleCredentials =
	process.env.RUN_LIVE_GEMINI_SMOKE === "true" && hasGoogleGenerativeAIEnv();

describe("tradingAgent smoke", () => {
	it.skipIf(!hasGoogleCredentials)(
		"produces a structured trading decision with a real Gemini model",
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
					model: getGoogleGeminiProvider()("gemini-2.5-flash"),
				},
			});

			logTradingDecision(result);

			expect(tradingDecisionSchema.parse(result.object)).toBeDefined();
			expect(result.object.reasoning.length).toBeGreaterThan(0);
		},
		60_000,
	);
});
