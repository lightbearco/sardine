import { useSessionDashboardLiveState } from "./useSessionDashboard";

export function useWatchlistSummary() {
	const { isConnected, watchlistSummaries } = useSessionDashboardLiveState();
	return { summaries: watchlistSummaries, isConnected };
}
