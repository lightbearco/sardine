import type { AgentRegistry, AgentRegistryEntry } from "#/agents/AgentRegistry";
import { createLogger } from "#/lib/logger";
import type { Order } from "#/types/market";
import type { StagedOrderResult } from "#/types/sim";

const log = createLogger("order-pipeline");

export function deduplicateStagedOrders(
	stagedOrders: StagedOrderResult[],
): StagedOrderResult[] {
	const ordersById = new Map<string, StagedOrderResult>();

	for (const stagedOrder of stagedOrders) {
		const existingOrder = ordersById.get(stagedOrder.order.id);
		if (!existingOrder) {
			ordersById.set(stagedOrder.order.id, stagedOrder);
			continue;
		}

		if (hasConflictingOrderIdentity(existingOrder.order, stagedOrder.order)) {
			log.error(
				{
					orderId: stagedOrder.order.id,
					existing: {
						agentId: existingOrder.order.agentId,
						symbol: existingOrder.order.symbol,
						side: existingOrder.order.side,
						type: existingOrder.order.type,
					},
					incoming: {
						agentId: stagedOrder.order.agentId,
						symbol: stagedOrder.order.symbol,
						side: stagedOrder.order.side,
						type: stagedOrder.order.type,
					},
				},
				"conflicting replay for order; discarding duplicate stage",
			);
			continue;
		}

		log.warn(
			{ orderId: stagedOrder.order.id },
			"duplicate staged order; keeping latest version",
		);
		ordersById.set(stagedOrder.order.id, stagedOrder);
	}

	return Array.from(ordersById.values());
}

export function partitionReplayedOpenOrders(
	agentRegistry: AgentRegistry,
	stagedOrders: StagedOrderResult[],
): {
	freshOrders: StagedOrderResult[];
	replayedOrders: StagedOrderResult[];
} {
	const freshOrders: StagedOrderResult[] = [];
	const replayedOrders: StagedOrderResult[] = [];

	for (const stagedOrder of stagedOrders) {
		const existingOrder = agentRegistry
			.get(stagedOrder.order.agentId)
			?.state.openOrders.get(stagedOrder.order.id);

		if (!existingOrder) {
			freshOrders.push(stagedOrder);
			continue;
		}

		log.warn(
			{ orderId: stagedOrder.order.id },
			"ignoring replayed open order; persisting current state without re-matching",
		);
		replayedOrders.push({
			...stagedOrder,
			order: existingOrder,
			reasoning: stagedOrder.reasoning ?? existingOrder.llmReasoning ?? null,
		});
	}

	return {
		freshOrders,
		replayedOrders,
	};
}

export function partitionUnsupportedOrders(
	supportedSymbols: ReadonlySet<string>,
	stagedOrders: StagedOrderResult[],
	changedAgentIds: Set<string>,
): {
	validOrders: StagedOrderResult[];
	rejectedOrders: StagedOrderResult[];
} {
	const validOrders: StagedOrderResult[] = [];
	const rejectedOrders: StagedOrderResult[] = [];

	for (const stagedOrder of stagedOrders) {
		if (supportedSymbols.has(stagedOrder.order.symbol)) {
			validOrders.push(stagedOrder);
			continue;
		}

		const rejectionReason = `[system] unsupported_symbol:${stagedOrder.order.symbol}`;
		log.warn(
			{ orderId: stagedOrder.order.id, symbol: stagedOrder.order.symbol },
			"rejecting order for unsupported symbol",
		);
		rejectedOrders.push({
			...stagedOrder,
			order: {
				...stagedOrder.order,
				status: "cancelled",
				llmReasoning: stagedOrder.order.llmReasoning
					? `${stagedOrder.order.llmReasoning}\n\n${rejectionReason}`
					: rejectionReason,
			},
			reasoning: stagedOrder.reasoning
				? `${stagedOrder.reasoning}\n\n${rejectionReason}`
				: rejectionReason,
		});
		changedAgentIds.add(stagedOrder.order.agentId);
	}

	return {
		validOrders,
		rejectedOrders,
	};
}

export function syncOrderState(
	agentRegistry: AgentRegistry,
	order: Order,
	changedAgentIds: Set<string>,
): void {
	const entry = agentRegistry.get(order.agentId);
	if (!entry) {
		return;
	}

	if (
		order.type === "limit" &&
		(order.status === "open" || order.status === "partial")
	) {
		entry.state.openOrders.set(order.id, order);
	} else {
		entry.state.openOrders.delete(order.id);
	}

	changedAgentIds.add(order.agentId);
}

export function pruneUnsupportedOpenOrders(
	supportedSymbols: ReadonlySet<string>,
	entries: AgentRegistryEntry[],
	changedAgentIds: Set<string>,
): void {
	for (const entry of entries) {
		const supportedOpenOrders = new Map<string, Order>();
		let removedUnsupported = false;

		for (const [orderId, order] of entry.state.openOrders.entries()) {
			if (supportedSymbols.has(order.symbol)) {
				supportedOpenOrders.set(orderId, order);
				continue;
			}

			removedUnsupported = true;
			log.warn(
				{ orderId: order.id, symbol: order.symbol },
				"dropping stale open order for unsupported symbol",
			);
		}

		if (!removedUnsupported) {
			continue;
		}

		entry.state.openOrders = supportedOpenOrders;
		changedAgentIds.add(entry.config.id);
	}
}

function hasConflictingOrderIdentity(left: Order, right: Order): boolean {
	return (
		left.agentId !== right.agentId ||
		left.symbol !== right.symbol ||
		left.side !== right.side ||
		left.type !== right.type
	);
}
