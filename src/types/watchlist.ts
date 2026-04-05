import type { OHLCVBarData, LOBSnapshotData, TradeData } from "#/types/market";

export interface WatchlistSummaryPayload {
	symbol: string;
	lastPrice: number | null;
	high: number | null;
	low: number | null;
	spread: number | null;
	lastBar?: OHLCVBarData;
	snapshot?: LOBSnapshotData;
	lastTrade?: TradeData;
	updatedAt: number;
}
