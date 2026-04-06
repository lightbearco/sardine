import type Decimal from "decimal.js";
import { nanoid } from "nanoid";
import type {
	LOBSnapshot,
	Order,
	OrderSide,
	PriceLevel,
	Trade,
} from "#/types/market.ts";
import { OrderQueue } from "./OrderQueue.ts";

interface PriceLevelEntry {
	price: Decimal;
	queue: OrderQueue;
}

export class LimitOrderBook {
	readonly symbol: string;
	private bids: PriceLevelEntry[] = []; // sorted descending
	private asks: PriceLevelEntry[] = []; // sorted ascending
	private orderIndex = new Map<string, { side: OrderSide; price: Decimal }>();
	private lastPrice: Decimal | null = null;

	constructor(symbol: string) {
		this.symbol = symbol;
	}

	addOrder(order: Order, tick: number): Trade[] {
		const trades: Trade[] = [];
		const oppositeSide = order.side === "buy" ? this.asks : this.bids;
		let remainingQty = order.qty - order.filledQty;

		// Check if order is marketable
		const isMarketable =
			order.type === "market" || this.isCrossing(order, oppositeSide);

		if (isMarketable) {
			while (remainingQty > 0 && oppositeSide.length > 0) {
				// For limit orders, stop if price no longer crosses
				if (order.type === "limit") {
					if (order.side === "buy" && order.price.lt(oppositeSide[0].price))
						break;
					if (order.side === "sell" && order.price.gt(oppositeSide[0].price))
						break;
				}

				const bestLevel = oppositeSide[0];
				const frontOrder = bestLevel.queue.peek();
				if (!frontOrder) break;
				const fillQty = Math.min(
					remainingQty,
					frontOrder.qty - frontOrder.filledQty,
				);
				const fillPrice = bestLevel.price;

				// Update filled quantities
				const prevRemainingFront = frontOrder.qty - frontOrder.filledQty;
				frontOrder.filledQty += fillQty;
				order.filledQty += fillQty;
				remainingQty -= fillQty;

				// Adjust the queue's running totalQty
				bestLevel.queue.adjustQty(
					-(prevRemainingFront - (frontOrder.qty - frontOrder.filledQty)),
				);

				// Update statuses
				frontOrder.status =
					frontOrder.filledQty === frontOrder.qty ? "filled" : "partial";
				order.status = order.filledQty === order.qty ? "filled" : "partial";

				// Create trade
				trades.push({
					id: nanoid(),
					buyOrderId: order.side === "buy" ? order.id : frontOrder.id,
					sellOrderId: order.side === "sell" ? order.id : frontOrder.id,
					buyerAgentId:
						order.side === "buy" ? order.agentId : frontOrder.agentId,
					sellerAgentId:
						order.side === "sell" ? order.agentId : frontOrder.agentId,
					symbol: this.symbol,
					price: fillPrice,
					qty: fillQty,
					tick,
				});

				this.lastPrice = fillPrice;

				// Remove filled resting order
				if (frontOrder.status === "filled") {
					bestLevel.queue.dequeue();
					this.orderIndex.delete(frontOrder.id);
					if (bestLevel.queue.isEmpty) {
						oppositeSide.shift();
					}
				}
			}
		}

		// Post-matching: rest or cancel remaining qty
		if (remainingQty > 0) {
			if (order.type === "limit") {
				// Rest in book
				if (order.filledQty === 0) {
					order.status = "open";
				}
				this.insertOrder(order);
			} else {
				// Market order with no more liquidity — cancel unfilled portion
				if (order.filledQty === 0) {
					order.status = "cancelled";
				}
				// If partially filled, status is already "partial"
			}
		}

		return trades;
	}

	cancelOrder(orderId: string): Order | null {
		const entry = this.orderIndex.get(orderId);
		if (!entry) return null;

		const levels = entry.side === "buy" ? this.bids : this.asks;
		const { index, found } = this.findLevelIndex(
			levels,
			entry.price,
			entry.side,
		);

		if (!found) return null;

		const level = levels[index];
		const order = level.queue.get(orderId);
		if (!order) return null;

		level.queue.remove(orderId);
		this.orderIndex.delete(orderId);
		order.status = "cancelled";

		if (level.queue.isEmpty) {
			levels.splice(index, 1);
		}

		return order;
	}

	getSnapshot(depth = 10): LOBSnapshot {
		return {
			symbol: this.symbol,
			bids: this.levelsToPriceLevels(this.bids, depth),
			asks: this.levelsToPriceLevels(this.asks, depth),
			lastPrice: this.lastPrice,
			spread: this.getSpread(),
		};
	}

	getBestBid(): Decimal | null {
		return this.bids[0]?.price ?? null;
	}

	getBestAsk(): Decimal | null {
		return this.asks[0]?.price ?? null;
	}

	getSpread(): Decimal | null {
		const bid = this.getBestBid();
		const ask = this.getBestAsk();
		if (!bid || !ask) return null;
		return ask.minus(bid);
	}

	getMidPrice(): Decimal | null {
		const bid = this.getBestBid();
		const ask = this.getBestAsk();
		if (!bid || !ask) return null;
		return bid.plus(ask).div(2);
	}

	sweepCrossingOrders(tick: number): Trade[] {
		const trades: Trade[] = [];

		while (this.bids.length > 0 && this.asks.length > 0) {
			const bestBid = this.bids[0];
			const bestAsk = this.asks[0];
			if (bestBid.price.lt(bestAsk.price)) break;

			const bidOrder = bestBid.queue.peek();
			const askOrder = bestAsk.queue.peek();
			if (!bidOrder || !askOrder) break;

			const fillQty = Math.min(
				bidOrder.qty - bidOrder.filledQty,
				askOrder.qty - askOrder.filledQty,
			);
			const fillPrice = bestAsk.price;

			const prevBidRemaining = bidOrder.qty - bidOrder.filledQty;
			const prevAskRemaining = askOrder.qty - askOrder.filledQty;

			bidOrder.filledQty += fillQty;
			askOrder.filledQty += fillQty;

			bestBid.queue.adjustQty(
				-(prevBidRemaining - (bidOrder.qty - bidOrder.filledQty)),
			);
			bestAsk.queue.adjustQty(
				-(prevAskRemaining - (askOrder.qty - askOrder.filledQty)),
			);

			bidOrder.status =
				bidOrder.filledQty === bidOrder.qty ? "filled" : "partial";
			askOrder.status =
				askOrder.filledQty === askOrder.qty ? "filled" : "partial";

			trades.push({
				id: nanoid(),
				buyOrderId: bidOrder.id,
				sellOrderId: askOrder.id,
				buyerAgentId: bidOrder.agentId,
				sellerAgentId: askOrder.agentId,
				symbol: this.symbol,
				price: fillPrice,
				qty: fillQty,
				tick,
			});

			this.lastPrice = fillPrice;

			if (bidOrder.status === "filled") {
				bestBid.queue.dequeue();
				this.orderIndex.delete(bidOrder.id);
				if (bestBid.queue.isEmpty) {
					this.bids.shift();
				}
			}
			if (askOrder.status === "filled") {
				bestAsk.queue.dequeue();
				this.orderIndex.delete(askOrder.id);
				if (bestAsk.queue.isEmpty) {
					this.asks.shift();
				}
			}
		}

		return trades;
	}

	getBidLevelCount(): number {
		return this.bids.length;
	}

	getAskLevelCount(): number {
		return this.asks.length;
	}

	// --- Private helpers ---

	private isCrossing(order: Order, oppositeSide: PriceLevelEntry[]): boolean {
		if (oppositeSide.length === 0) return false;
		const bestOpposite = oppositeSide[0].price;
		if (order.side === "buy") return order.price.gte(bestOpposite);
		return order.price.lte(bestOpposite);
	}

	private insertOrder(order: Order): void {
		const side = order.side;
		const levels = side === "buy" ? this.bids : this.asks;
		const { index, found } = this.findLevelIndex(levels, order.price, side);

		if (found) {
			levels[index].queue.add(order);
		} else {
			const queue = new OrderQueue();
			queue.add(order);
			levels.splice(index, 0, { price: order.price, queue });
		}

		this.orderIndex.set(order.id, { side, price: order.price });
	}

	private findLevelIndex(
		levels: PriceLevelEntry[],
		price: Decimal,
		side: OrderSide,
	): { found: boolean; index: number } {
		let lo = 0;
		let hi = levels.length;

		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			const cmp = levels[mid].price.comparedTo(price);

			if (cmp === 0) return { found: true, index: mid };

			// Bids: descending (higher prices first)
			// Asks: ascending (lower prices first)
			if (side === "buy") {
				if (cmp > 0) lo = mid + 1;
				else hi = mid;
			} else {
				if (cmp < 0) lo = mid + 1;
				else hi = mid;
			}
		}

		return { found: false, index: lo };
	}

	private levelsToPriceLevels(
		levels: PriceLevelEntry[],
		depth: number,
	): PriceLevel[] {
		const result: PriceLevel[] = [];
		const len = Math.min(levels.length, depth);
		for (let i = 0; i < len; i++) {
			result.push({
				price: levels[i].price,
				qty: levels[i].queue.totalQty,
				orderCount: levels[i].queue.size,
			});
		}
		return result;
	}
}
