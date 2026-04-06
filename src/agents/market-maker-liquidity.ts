import Decimal from "decimal.js";
import { nanoid } from "nanoid";
import type { AgentRegistry, AgentRegistryEntry } from "#/agents/AgentRegistry";
import type { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SIM_DEFAULTS } from "#/lib/constants";
import type { Order } from "#/types/market";
import type { StagedOrderResult } from "#/types/sim";

const REQUOTE_QTY = 100;
const DEFAULT_SPREAD_BPS = 8;
const BPS_DIVISOR = 10_000;

function isMarketMakerLike(entry: AgentRegistryEntry): boolean {
	const et = entry.config.entityType;
	return et === "market-maker" || et === "liquidity-provider";
}

function resolveSpreadBps(decisionParams: Record<string, number>): number {
	return (
		decisionParams.spreadTargetBps ??
		decisionParams.spreadBps ??
		DEFAULT_SPREAD_BPS
	);
}

export function requoteMarketMakers(
	registry: AgentRegistry,
	matchingEngine: MatchingEngine,
	simTick: number,
	minBookDepth: number = SIM_DEFAULTS.marketMakerMinBookDepth,
): StagedOrderResult[] {
	if (!SIM_DEFAULTS.marketMakerRequoteEnabled) return [];

	const stagedOrders: StagedOrderResult[] = [];

	for (const entry of registry.getAll()) {
		if (!isMarketMakerLike(entry)) continue;
		if (entry.state.status !== "active") continue;

		const symbols = entry.config.sectors;
		if (symbols.length === 0) continue;

		for (const symbol of symbols) {
			const book = matchingEngine.getBook(symbol);
			if (!book) continue;

			const bidLevels = book.getBidLevelCount();
			const askLevels = book.getAskLevelCount();
			const needsBids = bidLevels < minBookDepth;
			const needsAsks = askLevels < minBookDepth;
			if (!needsBids && !needsAsks) continue;

			const midPrice =
				book.getMidPrice() ?? book.getBestBid() ?? book.getBestAsk();
			if (!midPrice) continue;

			const spreadBps = resolveSpreadBps(entry.config.decisionParams);
			const halfSpread = midPrice.times(spreadBps).div(BPS_DIVISOR).div(2);

			if (needsBids && entry.state.cash.gt(0)) {
				const bidPrice = midPrice
					.minus(halfSpread)
					.toDecimalPlaces(2, Decimal.ROUND_DOWN);
				const maxAffordableQty = Math.floor(
					entry.state.cash.div(bidPrice).toNumber(),
				);
				const qty = Math.min(REQUOTE_QTY, maxAffordableQty);
				if (qty <= 0 || bidPrice.lte(0)) continue;

				const alreadyHasBidAtLevel =
					bidLevels > 0 && book.getBestBid()?.eq(bidPrice);
				if (alreadyHasBidAtLevel) continue;

				const order: Order = {
					id: nanoid(),
					symbol,
					side: "buy",
					type: "limit",
					price: bidPrice,
					qty,
					filledQty: 0,
					status: "pending",
					agentId: entry.config.id,
					createdAtTick: simTick,
				};
				stagedOrders.push({
					order,
					source: "market-maker-requote",
					agentName: entry.config.name,
					reasoning: "Systematic re-quote to maintain book liquidity",
				});
			}

			if (needsAsks) {
				const position = entry.state.positions.get(symbol);
				const availableQty = position?.qty ?? 0;
				if (availableQty <= 0) continue;

				const askPrice = midPrice
					.plus(halfSpread)
					.toDecimalPlaces(2, Decimal.ROUND_UP);
				if (askPrice.lte(0)) continue;

				const alreadyHasAskAtLevel =
					askLevels > 0 && book.getBestAsk()?.eq(askPrice);
				if (alreadyHasAskAtLevel) continue;

				const qty = Math.min(REQUOTE_QTY, availableQty);
				if (qty <= 0) continue;

				const order: Order = {
					id: nanoid(),
					symbol,
					side: "sell",
					type: "limit",
					price: askPrice,
					qty,
					filledQty: 0,
					status: "pending",
					agentId: entry.config.id,
					createdAtTick: simTick,
				};
				stagedOrders.push({
					order,
					source: "market-maker-requote",
					agentName: entry.config.name,
					reasoning: "Systematic re-quote to maintain book liquidity",
				});
			}
		}
	}

	return stagedOrders;
}
