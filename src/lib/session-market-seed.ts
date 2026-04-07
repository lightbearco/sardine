import type { LOBSnapshotData, OHLCVBarData, PriceLevelData } from "#/types/market";

export const DEFAULT_SESSION_SEED_PRICE = 150;
export const DEFAULT_SESSION_SEED_SPREAD = 0.1;
export const DEFAULT_SESSION_SEED_QTY = 100;
export const BOOTSTRAP_BAR_TICK = 0;

function roundPrice(value: number): number {
	return Number(value.toFixed(4));
}

function derivePriceFromLevels(
	levels: PriceLevelData[] | undefined,
	side: "buy" | "sell",
): number | null {
	if (!levels || levels.length === 0) {
		return null;
	}

	if (side === "buy") {
		return levels.reduce((best, level) => Math.max(best, level.price), -Infinity);
	}

	return levels.reduce((best, level) => Math.min(best, level.price), Infinity);
}

export function resolveSessionReferencePrice(input: {
	snapshot?:
		| Pick<LOBSnapshotData, "lastPrice" | "bids" | "asks">
		| null
		| undefined;
	bar?: Pick<OHLCVBarData, "close" | "open"> | null | undefined;
	fallbackPrice?: number;
}): number {
	const fallbackPrice = input.fallbackPrice ?? DEFAULT_SESSION_SEED_PRICE;
	const lastPrice = input.snapshot?.lastPrice;
	if (lastPrice !== null && lastPrice !== undefined) {
		return lastPrice;
	}

	const bestBid = derivePriceFromLevels(input.snapshot?.bids, "buy");
	const bestAsk = derivePriceFromLevels(input.snapshot?.asks, "sell");
	if (bestBid !== null && bestAsk !== null) {
		return roundPrice((bestBid + bestAsk) / 2);
	}

	if (bestBid !== null) {
		return bestBid;
	}

	if (bestAsk !== null) {
		return bestAsk;
	}

	if (input.bar?.close !== undefined && input.bar.close !== null) {
		return input.bar.close;
	}

	if (input.bar?.open !== undefined && input.bar.open !== null) {
		return input.bar.open;
	}

	return fallbackPrice;
}

export function resolveSessionSpread(
	snapshot?:
		| Pick<LOBSnapshotData, "spread" | "bids" | "asks">
		| null
		| undefined,
	fallbackSpread: number = DEFAULT_SESSION_SEED_SPREAD,
): number {
	if (
		snapshot?.spread !== null &&
		snapshot?.spread !== undefined &&
		snapshot.spread > 0
	) {
		return snapshot.spread;
	}

	const bestBid = derivePriceFromLevels(snapshot?.bids, "buy");
	const bestAsk = derivePriceFromLevels(snapshot?.asks, "sell");
	if (bestBid !== null && bestAsk !== null && bestAsk > bestBid) {
		return roundPrice(bestAsk - bestBid);
	}

	return fallbackSpread;
}

function buildSyntheticLevels(
	lastPrice: number,
	spread: number,
	qty: number,
): { bids: PriceLevelData[]; asks: PriceLevelData[] } {
	const halfSpread = spread / 2;
	return {
		bids: [
			{
				price: roundPrice(lastPrice - halfSpread),
				qty,
				orderCount: 1,
			},
		],
		asks: [
			{
				price: roundPrice(lastPrice + halfSpread),
				qty,
				orderCount: 1,
			},
		],
	};
}

export function buildSyntheticSnapshotData(input: {
	symbol: string;
	lastPrice: number;
	spread?: number;
	qty?: number;
	includeDepth?: boolean;
}): LOBSnapshotData {
	const spread = input.spread ?? DEFAULT_SESSION_SEED_SPREAD;
	const includeDepth = input.includeDepth ?? true;
	const levels = includeDepth
		? buildSyntheticLevels(
				input.lastPrice,
				spread,
				input.qty ?? DEFAULT_SESSION_SEED_QTY,
			)
		: { bids: [], asks: [] };

	return {
		symbol: input.symbol,
		bids: levels.bids,
		asks: levels.asks,
		lastPrice: input.lastPrice,
		spread,
	};
}

export function buildSyntheticBarData(input: {
	symbol: string;
	lastPrice: number;
	tick?: number;
	volume?: number;
}): OHLCVBarData {
	return {
		symbol: input.symbol,
		open: input.lastPrice,
		high: input.lastPrice,
		low: input.lastPrice,
		close: input.lastPrice,
		volume: input.volume ?? 0,
		tick: input.tick ?? BOOTSTRAP_BAR_TICK,
	};
}

export function buildSeedSymbolHydration(input: {
	symbol: string;
	lastBar?: OHLCVBarData | null;
	snapshot?: LOBSnapshotData | null;
	tick?: number | null;
	volume?: number | null;
	fallbackPrice?: number;
	includeDepth?: boolean;
}): {
	lastBar: OHLCVBarData;
	snapshot: LOBSnapshotData;
} {
	const lastPrice = resolveSessionReferencePrice({
		snapshot: input.snapshot,
		bar: input.lastBar,
		fallbackPrice: input.fallbackPrice,
	});
	const tick = input.lastBar?.tick ?? input.tick ?? BOOTSTRAP_BAR_TICK;
	const spread = resolveSessionSpread(input.snapshot);

	return {
		lastBar:
			input.lastBar ??
			buildSyntheticBarData({
				symbol: input.symbol,
				lastPrice,
				tick,
				volume: input.volume ?? 0,
			}),
		snapshot:
			input.snapshot ??
			buildSyntheticSnapshotData({
				symbol: input.symbol,
				lastPrice,
				spread,
				includeDepth: input.includeDepth,
			}),
	};
}
