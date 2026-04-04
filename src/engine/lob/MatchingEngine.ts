import Decimal from "decimal.js";
import { nanoid } from "nanoid";
import type { LOBSnapshot, Order, Trade } from "#/types/market.ts";
import { LimitOrderBook } from "./LimitOrderBook.ts";

export class MatchingEngine {
	private books = new Map<string, LimitOrderBook>();

	initialize(symbols: string[]): void {
		this.books.clear();
		for (const symbol of symbols) {
			this.books.set(symbol, new LimitOrderBook(symbol));
		}
	}

	processOrder(order: Order, tick: number): Trade[] {
		const book = this.books.get(order.symbol);
		if (!book) {
			throw new Error(`No order book for symbol: ${order.symbol}`);
		}
		return book.addOrder(order, tick);
	}

	processOrders(orders: Order[], tick: number): Trade[] {
		const trades: Trade[] = [];
		for (const order of orders) {
			trades.push(...this.processOrder(order, tick));
		}
		return trades;
	}

	cancelOrder(orderId: string, symbol: string): Order | null {
		const book = this.books.get(symbol);
		if (!book) return null;
		return book.cancelOrder(orderId);
	}

	getSnapshot(symbol: string, depth?: number): LOBSnapshot {
		const book = this.books.get(symbol);
		if (!book) {
			throw new Error(`No order book for symbol: ${symbol}`);
		}
		return book.getSnapshot(depth);
	}

	getBook(symbol: string): LimitOrderBook | undefined {
		return this.books.get(symbol);
	}

	getSymbols(): string[] {
		return Array.from(this.books.keys());
	}

	getReferencePrices(): Map<string, Decimal> {
		const referencePrices = new Map<string, Decimal>();

		for (const [symbol, book] of this.books.entries()) {
			const snapshot = book.getSnapshot(1);
			const referencePrice =
				snapshot.lastPrice ??
				book.getMidPrice() ??
				book.getBestBid() ??
				book.getBestAsk();

			if (referencePrice) {
				referencePrices.set(symbol, referencePrice);
			}
		}

		return referencePrices;
	}

	seedBook(
		symbol: string,
		midPrice: Decimal,
		spread: Decimal,
		depth: number,
		qtyPerLevel: number,
		tick: number,
	): void {
		const book = this.books.get(symbol);
		if (!book) {
			throw new Error(`No order book for symbol: ${symbol}`);
		}

		const halfSpread = spread.div(2);
		const bestBid = midPrice.minus(halfSpread);
		const bestAsk = midPrice.plus(halfSpread);
		const tickSize = new Decimal("0.01");

		for (let i = 0; i < depth; i++) {
			const bidPrice = bestBid.minus(tickSize.times(i));
			const askPrice = bestAsk.plus(tickSize.times(i));

			book.addOrder(
				{
					id: nanoid(),
					symbol,
					side: "buy",
					type: "limit",
					price: bidPrice,
					qty: qtyPerLevel,
					filledQty: 0,
					status: "pending",
					agentId: "market-maker-seed",
					createdAtTick: tick,
				},
				tick,
			);

			book.addOrder(
				{
					id: nanoid(),
					symbol,
					side: "sell",
					type: "limit",
					price: askPrice,
					qty: qtyPerLevel,
					filledQty: 0,
					status: "pending",
					agentId: "market-maker-seed",
					createdAtTick: tick,
				},
				tick,
			);
		}
	}
}
