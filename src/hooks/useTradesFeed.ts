import { useEffect, useState } from "react";
import { useSimWebSocket } from "./useSimWebSocket";
import type { Trade } from "#/types/market";

export function useTradesFeed(symbol: string) {
	const { subscribe, isConnected } = useSimWebSocket();
	const [trades, setTrades] = useState<Trade[]>([]);

	useEffect(() => {
		if (!symbol) {
			setTrades([]);
			return;
		}

		setTrades([]);

		const unsubscribe = subscribe(`trades:${symbol}`, (nextTrades: Trade[]) => {
			setTrades((previous) => [...nextTrades, ...previous].slice(0, 100));
		});

		return unsubscribe;
	}, [symbol, subscribe]);

	return { trades, isConnected };
}
