import { useMemo } from "react";
import { useSessionDashboard, useSessionDashboardLiveState } from "./useSessionDashboard";

export function useMarketData(symbol: string) {
	const { isConnected, symbolData } = useSessionDashboardLiveState();
	const { symbol: selectedSymbol, watchlist } = useSessionDashboard();
	const bars = useMemo(
		() =>
			symbol === selectedSymbol
				? symbolData.bars
				: watchlist[symbol]?.lastBar
					? [watchlist[symbol].lastBar]
					: [],
		[selectedSymbol, symbol, symbolData.bars, watchlist],
	);
	const lastBar = bars[bars.length - 1] ?? null;

	return { bars, lastBar, isConnected };
}
