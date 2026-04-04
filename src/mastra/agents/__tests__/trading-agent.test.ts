import { RequestContext } from "@mastra/core/request-context";
import type { MastraModelConfig } from "@mastra/core/llm";
import { describe, expect, it } from "vitest";
import {
	tradingAgent,
	tradingDecisionSchema,
} from "#/mastra/agents/trading-agent";
import type { TradingRequestContextValues } from "#/mastra/trading-context";
import { createToolHarness } from "#/mastra/tools/__tests__/test-helpers";

function logTradingDecision(label: string, result: {
	reasoningText?: string;
	object: {
		reasoning: string;
		ordersPlaced: unknown[];
		autopilotDirective: unknown;
	};
}) {
	console.log(`\n[${label}] Agent reasoning:\n${result.object.reasoning}`);

	if (result.reasoningText) {
		console.log(`\n[${label}] Model reasoning text:\n${result.reasoningText}`);
	}

	console.log(
		`\n[${label}] Orders placed:\n${JSON.stringify(result.object.ordersPlaced, null, 2)}`,
	);
	console.log(
		`\n[${label}] Autopilot directive:\n${JSON.stringify(result.object.autopilotDirective, null, 2)}`,
	);
}

function getAgentFields() {
	return tradingAgent.__getOverridableFields();
}

function getInstructions(
	requestContext?: RequestContext<TradingRequestContextValues>,
) {
	const fields = getAgentFields();

	if (typeof fields.instructions === "function") {
		return fields.instructions({ requestContext });
	}

	return fields.instructions;
}

function getModel(
	requestContext?: RequestContext<TradingRequestContextValues>,
): MastraModelConfig {
	const fields = getAgentFields();

	if (typeof fields.model === "function") {
		return fields.model({ requestContext });
	}

	return fields.model as MastraModelConfig;
}

describe("tradingAgent", () => {
	it("includes provided persona, agenda, biases, and constraints in instructions", () => {
		const { requestContext } = createToolHarness({
			configOverrides: {
				persona: "You are an aggressive event-driven trader.",
				currentAgenda: "Rotate into post-earnings dislocations.",
				investmentThesis: "High-quality growth should mean-revert after sharp gaps.",
				quarterlyGoal: "Capture event alpha while controlling gap risk.",
				personalityTraits: ["fast-moving", "conviction-led"],
				behavioralBiases: ["recency bias", "overconfidence"],
				constraints: ["Do not exceed 5% position sizing.", "Avoid restricted names."],
			},
		});

		const instructions = getInstructions(requestContext);

		expect(instructions).toContain("You are an aggressive event-driven trader.");
		expect(instructions).toContain("Rotate into post-earnings dislocations.");
		expect(instructions).toContain(
			"High-quality growth should mean-revert after sharp gaps.",
		);
		expect(instructions).toContain(
			"Capture event alpha while controlling gap risk.",
		);
		expect(instructions).toContain("fast-moving, conviction-led");
		expect(instructions).toContain("recency bias, overconfidence");
		expect(instructions).toContain("- Do not exceed 5% position sizing.");
		expect(instructions).toContain("- Avoid restricted names.");
	});

	it("falls back to safe defaults when optional context is missing", () => {
		const requestContext = new RequestContext<TradingRequestContextValues>();
		requestContext.set("persona", "You are a disciplined market participant.");
		requestContext.set(
			"current-agenda",
			"Preserve capital while looking for high-conviction trades.",
		);
		requestContext.set("personality-traits", []);
		requestContext.set("behavioral-biases", []);
		requestContext.set("constraints", []);

		const instructions = getInstructions(requestContext);

		expect(instructions).toContain(
			"You do not have a strong macro thesis and act opportunistically.",
		);
		expect(instructions).toContain(
			"Compound capital responsibly while avoiding catastrophic drawdowns.",
		);
		expect(instructions).toContain(
			"Traits: adaptable, opportunistic, risk-aware",
		);
		expect(instructions).toContain("Known biases: none explicitly noted");
		expect(instructions).toContain(
			"- Trade within your mandate, size risk deliberately, and respect tool validation.",
		);
	});

	it("maps sonnet tier to Gemini Pro and other tiers to Gemini Flash", () => {
		const sonnetContext = new RequestContext<TradingRequestContextValues>();
		sonnetContext.set("model-tier", "sonnet");

		const haikuContext = new RequestContext<TradingRequestContextValues>();
		haikuContext.set("model-tier", "haiku");

		const sonnetModel = getModel(sonnetContext) as {
			modelId?: string;
			provider?: string;
		};
		const haikuModel = getModel(haikuContext) as {
			modelId?: string;
			provider?: string;
		};

		expect(sonnetModel.modelId).toBe("gemini-2.5-pro");
		expect(sonnetModel.provider).toBe("google.generative-ai");
		expect(haikuModel.modelId).toBe("gemini-2.5-flash");
		expect(haikuModel.provider).toBe("google.generative-ai");
	});

	it("can generate structured output with a non-network mock model", async () => {
		const { requestContext } = createToolHarness();
		const { createMockModel } = (await import(
			"../../../../node_modules/@mastra/core/dist/test-utils/llm-mock.js"
		)) as {
			createMockModel: (args: {
				objectGenerationMode?: "json";
				mockText: unknown;
				version?: "v1" | "v2";
			}) => MastraModelConfig;
		};
		const mockModel = createMockModel({
			objectGenerationMode: "json",
			mockText: {
				reasoning: "No trade is warranted this tick.",
				ordersPlaced: [],
				autopilotDirective: {
					standingOrders: [],
					holdPositions: ["AAPL"],
					cancelIf: { symbol: "AAPL", condition: "price <= 90" },
				},
			},
		});

		const result = await tradingAgent.generate("What do you want to trade?", {
			requestContext,
			maxSteps: 1,
			model: mockModel,
			structuredOutput: {
				schema: tradingDecisionSchema,
				model: mockModel,
			},
		});

		logTradingDecision("mock-generate", result);

		expect(tradingDecisionSchema.parse(result.object)).toBeDefined();
		expect(result.object.ordersPlaced).toEqual([]);
		expect(result.object.autopilotDirective.holdPositions).toEqual(["AAPL"]);
		expect(result.object.reasoning).toContain("No trade is warranted");
	});
});
