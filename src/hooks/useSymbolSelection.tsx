import { useSessionDashboard } from "./useSessionDashboard";

export function useSymbolSelection() {
	const { symbol, setSymbol } = useSessionDashboard();
	return { symbol, setSymbol };
}
