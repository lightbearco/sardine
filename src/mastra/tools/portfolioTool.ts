import { createTool } from "@mastra/core/tools";
import Decimal from "decimal.js";
import { z } from "zod";
import type { Position } from "#/types/agent";
import type { Order } from "#/types/market";
import type { TradingRequestContextValues } from "#/mastra/trading-context";

const portfolioInputSchema = z.object({
	symbol: z.string().optional(),
});

const positionSnapshotSchema = z.object({
	symbol: z.string(),
	qty: z.number(),
	avgCost: z.string(),
	markPrice: z.string(),
	marketValue: z.string(),
	unrealizedPnl: z.string(),
});

const openOrderSnapshotSchema = z.object({
	orderId: z.string(),
	symbol: z.string(),
	side: z.enum(["buy", "sell"]),
	type: z.enum(["market", "limit"]),
	price: z.string(),
	qty: z.number(),
	filledQty: z.number(),
	status: z.enum(["pending", "open", "partial", "filled", "cancelled"]),
	createdAtTick: z.number(),
});

const portfolioOutputSchema = z.object({
	agentId: z.string(),
	capital: z.string(),
	cash: z.string(),
	nav: z.string(),
	totalPnl: z.string(),
	positions: z.array(positionSnapshotSchema),
	openOrders: z.array(openOrderSnapshotSchema),
});

function resolveMarkPrice(
	symbol: string,
	position: Position,
	engine: TradingRequestContextValues["matching-engine"],
): Decimal {
	const book = engine?.getBook(symbol);
	const lastPrice = book?.getSnapshot(1).lastPrice;

	if (lastPrice) {
		return lastPrice;
	}

	const midPrice = book?.getMidPrice();
	if (midPrice) {
		return midPrice;
	}

	return position.avgCost;
}

function serializeOrder(order: Order) {
	return {
		orderId: order.id,
		symbol: order.symbol,
		side: order.side,
		type: order.type,
		price: order.price.toString(),
		qty: order.qty,
		filledQty: order.filledQty,
		status: order.status,
		createdAtTick: order.createdAtTick,
	};
}

export const portfolioTool = createTool<
	"portfolio",
	typeof portfolioInputSchema,
	typeof portfolioOutputSchema,
	undefined,
	undefined,
	TradingRequestContextValues
>({
	id: "portfolio",
	description: "Read the calling agent's current positions, NAV, P&L, and open orders.",
	inputSchema: portfolioInputSchema,
	outputSchema: portfolioOutputSchema,
	execute: async (input, context) => {
		const requestContext = context?.requestContext;
		const registry = requestContext?.get("agent-registry");
		const engine = requestContext?.get("matching-engine");
		const agentId = requestContext?.get("agent-id");
		const capital = requestContext?.get("capital");

		if (!registry || !engine || !agentId || capital === undefined) {
			throw new Error(
				"portfolioTool requires agent-registry, matching-engine, agent-id, and capital in requestContext",
			);
		}

		const entry = registry.get(agentId);
		if (!entry) {
			throw new Error(`Unknown agent ID: ${agentId}`);
		}

		const positions = Array.from(entry.state.positions.entries())
			.filter(([symbol]) => input.symbol === undefined || symbol === input.symbol)
			.map(([symbol, position]) => {
				const markPrice = resolveMarkPrice(symbol, position, engine);
				const marketValue = markPrice.times(position.qty);
				const unrealizedPnl = markPrice.minus(position.avgCost).times(position.qty);

				return {
					symbol,
					qty: position.qty,
					avgCost: position.avgCost.toString(),
					markPrice: markPrice.toString(),
					marketValue: marketValue.toString(),
					unrealizedPnl: unrealizedPnl.toString(),
				};
			});

		const openOrders = Array.from(entry.state.openOrders.values())
			.filter((order) => input.symbol === undefined || order.symbol === input.symbol)
			.map(serializeOrder);

		return {
			agentId,
			capital: new Decimal(capital).toString(),
			cash: entry.state.cash.toString(),
			nav: entry.state.nav.toString(),
			totalPnl: entry.state.nav.minus(capital).toString(),
			positions,
			openOrders,
		};
	},
});
