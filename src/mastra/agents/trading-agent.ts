import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { firecrawlTool } from "#/mastra/tools/firecrawlTool";
import { TRADING_MODEL } from "#/mastra/models";
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

function listOrFallback(
	values: string[] | undefined,
	fallback: string,
): string {
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
		const persona =
			requestContext?.get("persona") ??
			"You are a disciplined market participant.";
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
		const strategy = requestContext?.get("strategy") ?? "opportunistic";
		const riskTolerance = requestContext?.get("risk-tolerance");
		const mandateSectors = asStringArray(
			requestContext?.get("mandate-sectors"),
		);
		const maxPositionPct = requestContext?.get("max-position-pct");
		const maxInventoryPerName = requestContext?.get("max-inventory-per-name");

		const constraintLines: string[] = [];
		if (constraints && constraints.length > 0) {
			constraintLines.push(...constraints.map((c) => `- ${c}`));
		} else {
			constraintLines.push(
				"- Trade within your mandate, size risk deliberately, and respect tool validation.",
			);
		}
		if (maxPositionPct !== undefined) {
			constraintLines.push(
				`- System max position size: ${(maxPositionPct * 100).toFixed(1)}% of NAV.`,
			);
		}
		if (maxInventoryPerName !== undefined) {
			constraintLines.push(
				`- System max inventory per name: $${maxInventoryPerName.toLocaleString()}.`,
			);
		}

		return `
${persona}

## Your Strategy
${strategy}

## Your Current Agenda
${agenda}

## Your Investment Thesis
${thesis}

## Your Quarterly Goal
${goal}

## Your Personality
Traits: ${listOrFallback(traits, "adaptable, opportunistic, risk-aware")}
Known biases: ${listOrFallback(biases, "none explicitly noted")}
Risk tolerance: ${riskTolerance !== undefined ? `${(riskTolerance * 100).toFixed(0)}% (0=very conservative, 100=very aggressive)` : "moderate"}

## Mandate Sectors
${mandateSectors && mandateSectors.length > 0 ? mandateSectors.join(", ") : "No sector restrictions"}

## Constraints
${constraintLines.join("\n")}

## Operating Rules
- Stay fully in character and let your stated traits and biases shape your behavior.
- Use firecrawlTool to scrape a news URL when you want current market context before deciding.
- Use marketDataTool before trading when price discovery matters.
- Use portfolioTool when you need to understand existing exposure or P&L.
- Use orderTool to place trades. You may submit multiple orders in a single turn — call orderTool once per order, then include all confirmations in ordersPlaced.
- **Order execution urgency**: Use market orders when you need immediate fills. For limit orders, price aggressively — at or through the best opposite side — to maximize fill probability. Passive limit orders far from the spread will not execute.
- Consider multi-leg strategies: pairs trades, scaling in/out, hedging existing positions, or rebalancing across multiple names.
- If you do not want to trade, return an empty ordersPlaced array.

## Response Contract
Return a structured object matching the provided schema:
1. \`reasoning\`: 2-3 sentences explaining your thinking this tick.
2. \`ordersPlaced\`: the exact order confirmations returned by orderTool for any trades you submit.
3. \`autopilotDirective\`: the standing orders and monitoring rules you want followed before your next LLM turn.
`.trim();
	},
	model: TRADING_MODEL,
	tools: {
		firecrawlTool,
		marketDataTool,
		portfolioTool,
		orderTool,
	},
});
