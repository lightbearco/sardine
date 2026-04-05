import { useMemo } from "react";
import { useSessionDashboard, useSessionDashboardLiveState } from "./useSessionDashboard";

export function useTradesFeed(symbol: string) {
	const { isConnected, symbolData } = useSessionDashboardLiveState();
	const { symbol: selectedSymbol } = useSessionDashboard();
	const trades = useMemo(
		() => (symbol === selectedSymbol ? symbolData.trades : []),
		[selectedSymbol, symbol, symbolData.trades],
	);

	return { trades, isConnected };
}
