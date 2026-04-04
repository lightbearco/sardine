import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { getGoogleGeminiProvider } from "#/mastra/google-gemini";
import { marketDataTool } from "#/mastra/tools/marketDataTool";
import { orderConfirmationSchema, orderTool } from "#/mastra/tools/orderTool";
import { portfolioTool } from "#/mastra/tools/portfolioTool";

const autopilotStandingOrderSchema = z.object({
	symbol: z.string(),
	side: z.enum(["buy", "sell"]),
	type: z.enum(["market", "limit"]),
	price: z.number().positive().optional(),
	qty: z.number().int().positive(),
});

const autopilotSignalSchema = z.object({
	symbol: z.string(),
	condition: z.string().min(1),
});

export const tradingDecisionSchema = z.object({
	reasoning: z.string(),
	ordersPlaced: z.array(orderConfirmationSchema),
	autopilotDirective: z.object({
		standingOrders: z.array(autopilotStandingOrderSchema),
		holdPositions: z.array(z.string()),
		cancelIf: autopilotSignalSchema.optional(),
		urgentReviewIf: autopilotSignalSchema.optional(),
	}),
});

export type TradingDecision = z.infer<typeof tradingDecisionSchema>;
export type { TradingRequestContextValues } from "#/mastra/trading-context";

function listOrFallback(values: string[] | undefined, fallback: string): string {
	if (!values || values.length === 0) {
		return fallback;
	}

	return values.join(", ");
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	return value.filter((item): item is string => typeof item === "string");
}

export const tradingAgent = new Agent({
	id: "trading-agent",
	name: "Trading Agent",
	description:
		"A shared Mastra trading agent template that adapts behavior from RequestContext.",
	instructions: ({ requestContext }) => {
		const persona = requestContext?.get("persona") ?? "You are a disciplined market participant.";
		const agenda =
			requestContext?.get("current-agenda") ??
			"Preserve capital while looking for high-conviction trades.";
		const thesis =
			requestContext?.get("investment-thesis") ??
			"You do not have a strong macro thesis and act opportunistically.";
		const goal =
			requestContext?.get("quarterly-goal") ??
			"Compound capital responsibly while avoiding catastrophic drawdowns.";
		const traits = asStringArray(requestContext?.get("personality-traits"));
		const biases = asStringArray(requestContext?.get("behavioral-biases"));
		const constraints = asStringArray(requestContext?.get("constraints"));

		return `
${persona}

## Your Current Agenda
${agenda}

## Your Investment Thesis
${thesis}

## Your Quarterly Goal
${goal}

## Your Personality
Traits: ${listOrFallback(traits, "adaptable, opportunistic, risk-aware")}
Known biases: ${listOrFallback(biases, "none explicitly noted")}

## Constraints
${constraints && constraints.length > 0 ? constraints.map((constraint) => `- ${constraint}`).join("\n") : "- Trade within your mandate, size risk deliberately, and respect tool validation."}

## Operating Rules
- Stay fully in character and let your stated traits and biases shape your behavior.
- Use marketDataTool before trading when price discovery matters.
- Use portfolioTool when you need to understand existing exposure or P&L.
- Use orderTool to place any desired trade.
- If you do not want to trade, return an empty ordersPlaced array.

## Response Contract
Return a structured object matching the provided schema:
1. \`reasoning\`: 2-3 sentences explaining your thinking this tick.
2. \`ordersPlaced\`: the exact order confirmations returned by orderTool for any trades you submit.
3. \`autopilotDirective\`: the standing orders and monitoring rules you want followed before your next LLM turn.
`.trim();
	},
	model: ({ requestContext }) => {
		const modelTier = requestContext?.get("model-tier");
		const googleProvider = getGoogleGeminiProvider();
		return modelTier === "sonnet"
			? googleProvider("gemini-2.5-pro")
			: googleProvider("gemini-2.5-flash");
	},
	tools: {
		marketDataTool,
		portfolioTool,
		orderTool,
	},
});
