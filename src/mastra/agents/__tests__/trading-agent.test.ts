import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it } from "vitest";
import { tradingAgent } from "#/mastra/agents/trading-agent";
import { createToolHarness } from "#/mastra/tools/__tests__/test-helpers";
import type { TradingRequestContextValues } from "#/mastra/trading-context";

function getAgentFields() {
	return tradingAgent.__getOverridableFields();
}

function getInstructions(
	requestContext: RequestContext<TradingRequestContextValues>,
) {
	const fields = getAgentFields();

	const normalizedContext = requestContext as RequestContext<unknown>;

	if (typeof fields.instructions === "function") {
		return fields.instructions({ requestContext: normalizedContext });
	}

	return fields.instructions;
}

describe("tradingAgent", () => {
	it("includes provided persona, agenda, biases, and constraints in instructions", () => {
		const { requestContext } = createToolHarness({
			configOverrides: {
				persona: "You are an aggressive event-driven trader.",
				currentAgenda: "Rotate into post-earnings dislocations.",
				investmentThesis:
					"High-quality growth should mean-revert after sharp gaps.",
				quarterlyGoal: "Capture event alpha while controlling gap risk.",
				personalityTraits: ["fast-moving", "conviction-led"],
				behavioralBiases: ["recency bias", "overconfidence"],
				constraints: [
					"Do not exceed 5% position sizing.",
					"Avoid restricted names.",
				],
			},
		});

		const instructions = getInstructions(requestContext);

		expect(instructions).toContain(
			"You are an aggressive event-driven trader.",
		);
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
});
