import { createTool } from "@mastra/core/tools";
import Decimal from "decimal.js";
import { z } from "zod";
import type { TradingRequestContextValues } from "#/mastra/trading-context";

const serializedPriceLevelSchema = z.object({
	price: z.string(),
	qty: z.number(),
	orderCount: z.number(),
});

const marketDataInputSchema = z.object({
	symbol: z.string().min(1),
	depth: z.number().int().positive().max(50).optional(),
});

const marketDataOutputSchema = z.object({
	symbol: z.string(),
	bids: z.array(serializedPriceLevelSchema),
	asks: z.array(serializedPriceLevelSchema),
	lastPrice: z.string().nullable(),
	spread: z.string().nullable(),
});

function decimalToString(value: Decimal | null): string | null {
	return value ? value.toString() : null;
}

export const marketDataTool = createTool<
	"market-data",
	typeof marketDataInputSchema,
	typeof marketDataOutputSchema,
	undefined,
	undefined,
	TradingRequestContextValues
>({
	id: "market-data",
	description: "Read the latest order book snapshot for a symbol.",
	inputSchema: marketDataInputSchema,
	outputSchema: marketDataOutputSchema,
	execute: async (input, context) => {
		const requestContext = context?.requestContext;
		const engine = requestContext?.get("matching-engine");

		if (!engine) {
			throw new Error("marketDataTool requires a matching-engine in requestContext");
		}

		const snapshot = engine.getSnapshot(input.symbol, input.depth);

		return {
			symbol: snapshot.symbol,
			bids: snapshot.bids.map((level) => ({
				price: level.price.toString(),
				qty: level.qty,
				orderCount: level.orderCount,
			})),
			asks: snapshot.asks.map((level) => ({
				price: level.price.toString(),
				qty: level.qty,
				orderCount: level.orderCount,
			})),
			lastPrice: decimalToString(snapshot.lastPrice),
			spread: decimalToString(snapshot.spread),
		};
	},
});
