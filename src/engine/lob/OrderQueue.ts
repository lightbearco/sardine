import type { Order } from "#/types/market.ts";

export class OrderQueue {
	private orders = new Map<string, Order>();
	private _totalQty = 0;

	add(order: Order): void {
		this.orders.set(order.id, order);
		this._totalQty += order.qty - order.filledQty;
	}

	remove(orderId: string): boolean {
		const order = this.orders.get(orderId);
		if (!order) return false;
		this._totalQty -= order.qty - order.filledQty;
		this.orders.delete(orderId);
		return true;
	}

	peek(): Order | undefined {
		return this.orders.values().next().value;
	}

	dequeue(): Order | undefined {
		const first = this.orders.values().next().value;
		if (first) {
			this.orders.delete(first.id);
			this._totalQty -= first.qty - first.filledQty;
		}
		return first;
	}

	get size(): number {
		return this.orders.size;
	}

	get totalQty(): number {
		return this._totalQty;
	}

	get isEmpty(): boolean {
		return this.orders.size === 0;
	}

	get(orderId: string): Order | undefined {
		return this.orders.get(orderId);
	}

	/** Adjust running totalQty after a partial fill on a resting order */
	adjustQty(delta: number): void {
		this._totalQty += delta;
	}
}
