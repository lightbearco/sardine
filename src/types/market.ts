import type Decimal from "decimal.js";

// ── Enums ──

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type OrderStatus =
	| "pending"
	| "open"
	| "partial"
	| "filled"
	| "cancelled";

// ── Core Types ──

export interface Order {
	id: string;
	symbol: string;
	side: OrderSide;
	type: OrderType;
	price: Decimal;
	qty: number;
	filledQty: number;
	status: OrderStatus;
	agentId: string;
	llmReasoning?: string;
	createdAtTick: number;
}

export interface Trade {
	id: string;
	buyOrderId: string;
	sellOrderId: string;
	buyerAgentId: string;
	sellerAgentId: string;
	symbol: string;
	price: Decimal;
	qty: number;
	tick: number;
}

export interface OHLCVBar {
	symbol: string;
	open: Decimal;
	high: Decimal;
	low: Decimal;
	close: Decimal;
	volume: number;
	tick: number;
}

// ── Order Book ──

export interface PriceLevel {
	price: Decimal;
	qty: number;
	orderCount: number;
}

export interface LOBSnapshot {
	symbol: string;
	bids: PriceLevel[];
	asks: PriceLevel[];
	lastPrice: Decimal | null;
	spread: Decimal | null;
}

// ── Wire-safe variants (plain numbers, safe to serialize across server/client boundary) ──

export interface PriceLevelData {
	price: number;
	qty: number;
	orderCount: number;
}

export interface LOBSnapshotData {
	symbol: string;
	bids: PriceLevelData[];
	asks: PriceLevelData[];
	lastPrice: number | null;
	spread: number | null;
}

export interface OHLCVBarData {
	symbol: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
	tick: number;
}

export interface TradeData {
	id: string;
	buyOrderId: string;
	sellOrderId: string;
	buyerAgentId: string;
	sellerAgentId: string;
	symbol: string;
	price: number;
	qty: number;
	tick: number;
}
