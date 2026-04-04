import { createTool } from "@mastra/core/tools";
import Decimal from "decimal.js";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { Order, OrderSide, OrderType } from "#/types/market";
import type { TradingRequestContextValues } from "#/mastra/trading-context";

const orderTradeSchema = z.object({
	tradeId: z.string(),
	symbol: z.string(),
	price: z.string(),
	qty: z.number(),
	tick: z.number(),
	buyerAgentId: z.string(),
	sellerAgentId: z.string(),
});

export const orderConfirmationSchema = z.object({
	orderId: z.string(),
	symbol: z.string(),
	side: z.enum(["buy", "sell"]),
	type: z.enum(["market", "limit"]),
	qty: z.number(),
	price: z.string(),
	status: z.enum(["pending", "open", "partial", "filled", "cancelled"]),
	filledQty: z.number(),
	trades: z.array(orderTradeSchema),
	rejectionReason: z.string().optional(),
});

const orderInputSchema = z.object({
	side: z.enum(["buy", "sell"]),
	type: z.enum(["market", "limit"]),
	symbol: z.string().min(1),
	price: z.number().positive().optional(),
	qty: z.number().int().positive(),
});

function buildRejectedConfirmation(
	input: z.infer<typeof orderInputSchema>,
	rejectionReason: string,
) {
	return {
		orderId: `rejected:${input.symbol}:${input.side}:${input.type}`,
		symbol: input.symbol,
		side: input.side,
		type: input.type,
		qty: input.qty,
		price: input.price === undefined ? "0" : String(input.price),
		status: "cancelled" as const,
		filledQty: 0,
		trades: [],
		rejectionReason,
	};
}

function resolveReferencePrice(
	type: OrderType,
	side: OrderSide,
	symbol: string,
	limitPrice: Decimal | undefined,
	requestContext: TradingRequestContextValues,
): Decimal {
	if (type === "limit" && limitPrice) {
		return limitPrice;
	}

	const engine = requestContext["matching-engine"];
	const book = engine?.getBook(symbol);

	if (!book) {
		throw new Error(`No order book for symbol: ${symbol}`);
	}

	const bestAsk = book.getBestAsk();
	const bestBid = book.getBestBid();
	const lastPrice = book.getSnapshot(1).lastPrice;
	const midPrice = book.getMidPrice();

	if (side === "buy" && bestAsk) {
		return bestAsk;
	}

	if (side === "sell" && bestBid) {
		return bestBid;
	}

	return lastPrice ?? midPrice ?? new Decimal(0);
}

export const orderTool = createTool<
	"submit-order",
	typeof orderInputSchema,
	typeof orderConfirmationSchema,
	undefined,
	undefined,
	TradingRequestContextValues
>({
	id: "submit-order",
	description:
		"Submit a limit or market order for the calling agent after validating the agent's trading constraints.",
	inputSchema: orderInputSchema,
	outputSchema: orderConfirmationSchema,
	execute: async (input, context) => {
		const requestContext = context?.requestContext;
		const registry = requestContext?.get("agent-registry");
		const engine = requestContext?.get("matching-engine");
		const simTick = requestContext?.get("sim-tick");
		const agentId = requestContext?.get("agent-id");
		const maxPositionPct = requestContext?.get("max-position-pct");
		const maxInventoryPerName = requestContext?.get("max-inventory-per-name");
		const restrictedSymbols = requestContext?.get("restricted-symbols") ?? [];

		if (!requestContext || !registry || !engine || simTick === undefined || !agentId) {
			throw new Error(
				"orderTool requires requestContext with agent-registry, matching-engine, sim-tick, and agent-id",
			);
		}

		const entry = registry.get(agentId);
		if (!entry) {
			throw new Error(`Unknown agent ID: ${agentId}`);
		}

		if (input.type === "limit" && input.price === undefined) {
			return buildRejectedConfirmation(
				input,
				"Limit orders require a price.",
			);
		}

		if (engine.getBook(input.symbol) === undefined) {
			return buildRejectedConfirmation(
				input,
				`Unknown symbol: ${input.symbol}`,
			);
		}

		if (restrictedSymbols.includes(input.symbol)) {
			return buildRejectedConfirmation(
				input,
				`${input.symbol} is restricted for this agent.`,
			);
		}

		const orderPrice =
			input.type === "limit" ? new Decimal(input.price ?? 0) : new Decimal(0);
		const referencePrice = resolveReferencePrice(
			input.type,
			input.side,
			input.symbol,
			input.type === "limit" ? orderPrice : undefined,
			requestContext.all,
		);
		const currentQty = entry.state.positions.get(input.symbol)?.qty ?? 0;
		const signedQty = input.side === "buy" ? input.qty : -input.qty;
		const nextQty = currentQty + signedQty;
		const projectedNotional = referencePrice.abs().times(Math.abs(nextQty));

		if (
			maxPositionPct !== undefined &&
			entry.state.nav.gt(0) &&
			projectedNotional.div(entry.state.nav).gt(maxPositionPct)
		) {
			return buildRejectedConfirmation(
				input,
				`Order exceeds max position limit of ${(maxPositionPct * 100).toFixed(2)}%.`,
			);
		}

		if (
			maxInventoryPerName !== undefined &&
			projectedNotional.gt(maxInventoryPerName)
		) {
			return buildRejectedConfirmation(
				input,
				`Order exceeds max inventory per name limit of ${maxInventoryPerName}.`,
			);
		}

		const order: Order = {
			id: nanoid(),
			symbol: input.symbol,
			side: input.side,
			type: input.type,
			price: orderPrice,
			qty: input.qty,
			filledQty: 0,
			status: "pending",
			agentId,
			createdAtTick: simTick,
		};

		return {
			orderId: order.id,
			symbol: order.symbol,
			side: order.side,
			type: order.type,
			qty: order.qty,
			price: order.price.toString(),
			status: "pending",
			filledQty: order.filledQty,
			trades: [],
		};
	},
});
