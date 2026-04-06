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
	weightPct: z.string(),
	realizedPnl: z.string(),
});

const constraintStatusSchema = z.object({
	maxPositionPct: z
		.object({
			limit: z.string(),
			current: z.string(),
		})
		.optional(),
	maxInventoryPerName: z
		.object({
			limit: z.string(),
			current: z.string(),
		})
		.optional(),
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
	pnlPct: z.string(),
	totalRealizedPnl: z.string(),
	positions: z.array(positionSnapshotSchema),
	openOrders: z.array(openOrderSnapshotSchema),
	constraintStatus: constraintStatusSchema,
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
	description:
		"Read the calling agent's current positions, NAV, P&L, and open orders.",
	inputSchema: portfolioInputSchema,
	outputSchema: portfolioOutputSchema,
	execute: async (input, context) => {
		const requestContext = context?.requestContext;
		const registry = requestContext?.get("agent-registry");
		const engine = requestContext?.get("matching-engine");
		const agentId = requestContext?.get("agent-id");
		const capital = requestContext?.get("capital");
		const maxPositionPct = requestContext?.get("max-position-pct");
		const maxInventoryPerName = requestContext?.get("max-inventory-per-name");

		if (!registry || !engine || !agentId || capital === undefined) {
			throw new Error(
				"portfolioTool requires agent-registry, matching-engine, agent-id, and capital in requestContext",
			);
		}

		const entry = registry.get(agentId);
		if (!entry) {
			throw new Error(`Unknown agent ID: ${agentId}`);
		}

		const nav = entry.state.nav;
		const capitalDecimal = new Decimal(capital);

		const positions = Array.from(entry.state.positions.entries())
			.filter(
				([symbol]) => input.symbol === undefined || symbol === input.symbol,
			)
			.map(([symbol, position]) => {
				const markPrice = resolveMarkPrice(symbol, position, engine);
				const marketValue = markPrice.times(position.qty);
				const unrealizedPnl = markPrice
					.minus(position.avgCost)
					.times(position.qty);
				const weightPct = nav.gt(0)
					? marketValue.div(nav).times(100)
					: new Decimal(0);
				const realizedPnl =
					entry.state.realizedPnl.get(symbol) ?? new Decimal(0);

				return {
					symbol,
					qty: position.qty,
					avgCost: position.avgCost.toString(),
					markPrice: markPrice.toString(),
					marketValue: marketValue.toString(),
					unrealizedPnl: unrealizedPnl.toString(),
					weightPct: weightPct.toDecimalPlaces(2).toString(),
					realizedPnl: realizedPnl.toString(),
				};
			});

		const openOrders = Array.from(entry.state.openOrders.values())
			.filter(
				(order) => input.symbol === undefined || order.symbol === input.symbol,
			)
			.map(serializeOrder);

		const totalPnl = nav.minus(capitalDecimal);
		const pnlPct = capitalDecimal.gt(0)
			? totalPnl.div(capitalDecimal).times(100).toDecimalPlaces(2)
			: new Decimal(0);

		const totalRealizedPnl = Array.from(
			entry.state.realizedPnl.values(),
		).reduce((sum, pnl) => sum.plus(pnl), new Decimal(0));

		const constraintStatus: z.infer<typeof constraintStatusSchema> = {};

		if (maxPositionPct !== undefined) {
			const limit = new Decimal(maxPositionPct).times(100);
			const maxCurrent = positions.reduce(
				(max, p) => Decimal.max(max, new Decimal(p.weightPct)),
				new Decimal(0),
			);
			constraintStatus.maxPositionPct = {
				limit: limit.toDecimalPlaces(2).toString(),
				current: maxCurrent.toDecimalPlaces(2).toString(),
			};
		}

		if (maxInventoryPerName !== undefined) {
			const limit = new Decimal(maxInventoryPerName);
			const maxInventory = positions.reduce(
				(max, p) => Decimal.max(max, new Decimal(p.marketValue)),
				new Decimal(0),
			);
			constraintStatus.maxInventoryPerName = {
				limit: limit.toString(),
				current: maxInventory.toString(),
			};
		}

		return {
			agentId,
			capital: capitalDecimal.toString(),
			cash: entry.state.cash.toString(),
			nav: nav.toString(),
			totalPnl: totalPnl.toString(),
			pnlPct: pnlPct.toString(),
			totalRealizedPnl: totalRealizedPnl.toString(),
			positions,
			openOrders,
			constraintStatus,
		};
	},
});
