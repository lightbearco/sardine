import { useSessionDashboard, useSessionDashboardLiveState } from "./useSessionDashboard";

export function useOrderBook(symbol: string) {
	const { isConnected, symbolData } = useSessionDashboardLiveState();
	const {
		symbol: selectedSymbol,
		watchlist,
	} = useSessionDashboard();
	const snapshot =
		symbol === selectedSymbol
			? symbolData.snapshot
			: watchlist[symbol]?.snapshot ?? null;

	return { snapshot, isConnected };
}
