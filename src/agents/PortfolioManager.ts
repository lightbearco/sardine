import Decimal from "decimal.js";
import type { Position } from "#/types/agent";
import type { Trade } from "#/types/market";
import { AgentRegistry } from "./AgentRegistry";

export class PortfolioManager {
	reconcile(
		trades: Trade[],
		registry: AgentRegistry,
		latestPrices: ReadonlyMap<string, Decimal>,
	): void {
		const touchedAgentIds = new Set<string>();

		for (const trade of trades) {
			const buyerEntry = registry.get(trade.buyerAgentId);
			const sellerEntry = registry.get(trade.sellerAgentId);

			// Skip trades involving unregistered agents (e.g. seed liquidity "market-maker-seed")
			if (!buyerEntry && !sellerEntry) continue;

			if (trade.buyerAgentId === trade.sellerAgentId) {
				if (buyerEntry) touchedAgentIds.add(trade.buyerAgentId);
				continue;
			}

			const notional = trade.price.times(trade.qty);

			if (buyerEntry) {
				touchedAgentIds.add(trade.buyerAgentId);
				buyerEntry.state.cash = buyerEntry.state.cash.minus(notional);
				this.applyPositionDelta(
					buyerEntry.state.positions,
					trade.symbol,
					trade.qty,
					trade.price,
				);
			}

			if (sellerEntry) {
				touchedAgentIds.add(trade.sellerAgentId);
				sellerEntry.state.cash = sellerEntry.state.cash.plus(notional);
				this.applyPositionDelta(
					sellerEntry.state.positions,
					trade.symbol,
					-trade.qty,
					trade.price,
				);
			}
		}

		for (const agentId of touchedAgentIds) {
			const entry = registry.get(agentId);
			if (!entry) continue;

			entry.state.nav = this.computeNav(
				entry.state.cash,
				entry.state.positions,
				latestPrices,
			);
		}
	}

	private applyPositionDelta(
		positions: Map<string, Position>,
		symbol: string,
		deltaQty: number,
		tradePrice: Decimal,
	): void {
		if (deltaQty === 0) {
			return;
		}

		const current = positions.get(symbol);
		const currentQty = current?.qty ?? 0;
		const nextQty = currentQty + deltaQty;

		if (nextQty === 0) {
			positions.delete(symbol);
			return;
		}

		if (!current || currentQty === 0) {
			positions.set(symbol, {
				qty: nextQty,
				avgCost: tradePrice,
			});
			return;
		}

		if (Math.sign(currentQty) === Math.sign(deltaQty)) {
			const nextAvgCost = current.avgCost
				.times(Math.abs(currentQty))
				.plus(tradePrice.times(Math.abs(deltaQty)))
				.div(Math.abs(nextQty));

			positions.set(symbol, {
				qty: nextQty,
				avgCost: nextAvgCost,
			});
			return;
		}

		if (Math.sign(nextQty) === Math.sign(currentQty)) {
			positions.set(symbol, {
				qty: nextQty,
				avgCost: current.avgCost,
			});
			return;
		}

		positions.set(symbol, {
			qty: nextQty,
			avgCost: tradePrice,
		});
	}

	private computeNav(
		cash: Decimal,
		positions: Map<string, Position>,
		latestPrices: ReadonlyMap<string, Decimal>,
	): Decimal {
		let nav = cash;

		for (const [symbol, position] of positions) {
			const currentPrice = latestPrices.get(symbol);
			if (!currentPrice) {
				throw new Error(`Missing latest price for symbol: ${symbol}`);
			}

			nav = nav.plus(currentPrice.times(position.qty));
		}

		return nav;
	}
}
