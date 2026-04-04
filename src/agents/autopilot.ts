import Decimal from "decimal.js";
import type {
	AgentState,
	AutopilotExecutionResult,
	AutopilotStandingOrder,
} from "#/types/agent";
import type { Order } from "#/types/market";

type PriceCondition = {
	operator: ">" | ">=" | "<" | "<=";
	threshold: number;
};

const OPEN_STATUSES: ReadonlySet<Order["status"]> = new Set([
	"pending",
	"open",
	"partial",
]);

function parsePriceCondition(condition: string): PriceCondition | null {
	const match = /^\s*price\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$/i.exec(condition);
	if (!match) {
		return null;
	}

	return {
		operator: match[1] as PriceCondition["operator"],
		threshold: Number(match[2]),
	};
}

function evaluateCondition(
	symbol: string,
	condition: string,
	currentPrices: ReadonlyMap<string, number>,
): boolean {
	const parsed = parsePriceCondition(condition);
	const currentPrice = currentPrices.get(symbol);

	if (!parsed || currentPrice === undefined) {
		return false;
	}

	switch (parsed.operator) {
		case ">":
			return currentPrice > parsed.threshold;
		case ">=":
			return currentPrice >= parsed.threshold;
		case "<":
			return currentPrice < parsed.threshold;
		case "<=":
			return currentPrice <= parsed.threshold;
	}
}

function isOrderOpen(order: Order): boolean {
	return OPEN_STATUSES.has(order.status);
}

function pricesMatch(left: Decimal, right?: number): boolean {
	if (right === undefined) {
		return left.eq(0);
	}

	return left.eq(right);
}

function standingOrderMatchesOpenOrder(
	standingOrder: AutopilotStandingOrder,
	order: Order,
): boolean {
	return (
		order.symbol === standingOrder.symbol &&
		order.side === standingOrder.side &&
		order.type === standingOrder.type &&
		order.qty === standingOrder.qty &&
		isOrderOpen(order) &&
		pricesMatch(order.price, standingOrder.price)
	);
}

function buildAutopilotOrderId(
	agentId: string,
	simTick: number,
	index: number,
	standingOrder: AutopilotStandingOrder,
): string {
	const priceToken =
		standingOrder.type === "limit" ? String(standingOrder.price ?? 0) : "market";

	return [
		"autopilot",
		agentId,
		String(simTick),
		String(index),
		standingOrder.symbol,
		standingOrder.side,
		standingOrder.type,
		priceToken,
		String(standingOrder.qty),
	].join(":");
}

export function executeAutopilot(
	agent: AgentState,
	currentPrices: ReadonlyMap<string, number>,
	simTick: number,
): AutopilotExecutionResult {
	const directive = agent.lastAutopilotDirective;

	if (!directive) {
		return {
			orders: [],
			cancelOrderIds: [],
			urgentReview: false,
		};
	}

	const cancelTriggered =
		directive.cancelIf !== undefined &&
		evaluateCondition(
			directive.cancelIf.symbol,
			directive.cancelIf.condition,
			currentPrices,
		);

	const cancelOrderIds =
		cancelTriggered && directive.cancelIf
			? Array.from(agent.openOrders.values())
					.filter(
						(order) =>
							order.symbol === directive.cancelIf?.symbol && isOrderOpen(order),
					)
					.map((order) => order.id)
			: [];

	const orders = directive.standingOrders.flatMap((standingOrder, index) => {
		if (
			cancelTriggered &&
			directive.cancelIf &&
			standingOrder.symbol === directive.cancelIf.symbol
		) {
			return [];
		}

		const alreadyOpen = Array.from(agent.openOrders.values()).some((order) =>
			standingOrderMatchesOpenOrder(standingOrder, order),
		);

		if (alreadyOpen) {
			return [];
		}

		if (standingOrder.type === "limit" && standingOrder.price === undefined) {
			return [];
		}

		return [
			{
				id: buildAutopilotOrderId(agent.id, simTick, index, standingOrder),
				symbol: standingOrder.symbol,
				side: standingOrder.side,
				type: standingOrder.type,
				price: new Decimal(standingOrder.price ?? 0),
				qty: standingOrder.qty,
				filledQty: 0,
				status: "pending" as const,
				agentId: agent.id,
				createdAtTick: simTick,
			},
		];
	});

	const urgentReview =
		directive.urgentReviewIf !== undefined &&
		evaluateCondition(
			directive.urgentReviewIf.symbol,
			directive.urgentReviewIf.condition,
			currentPrices,
		);

	return {
		orders,
		cancelOrderIds,
		urgentReview,
	};
}
