import { useState, useEffect, useMemo } from "react";
import { useSimWebSocket } from "./useSimWebSocket";
import { useSessionDashboard } from "./useSessionDashboard";
import type { OHLCVBarData } from "#/types/market";

function mergeBar(previous: OHLCVBarData[], bar: OHLCVBarData): OHLCVBarData[] {
	const lastBar = previous[previous.length - 1];
	if (lastBar && lastBar.tick === bar.tick) {
		return [...previous.slice(0, -1), bar];
	}

	return [...previous, bar];
}

export function useMarketData(symbol: string) {
  const { subscribe, isConnected } = useSimWebSocket();
  const {
	sessionId,
	isLive,
	symbol: selectedSymbol,
	bars: selectedBars,
	watchlist,
  } = useSessionDashboard();
  const initialBars = useMemo(
	() =>
		symbol === selectedSymbol
			? selectedBars
			: watchlist[symbol]?.lastBar
				? [watchlist[symbol].lastBar]
				: [],
	[selectedBars, selectedSymbol, symbol, watchlist],
  );
  const initialLastBar = initialBars[initialBars.length - 1] ?? null;
  const [bars, setBars] = useState<OHLCVBarData[]>(initialBars);
  const [lastBar, setLastBar] = useState<OHLCVBarData | null>(initialLastBar);

  useEffect(() => {
    if (!symbol) return;
    
    setBars(initialBars);
    setLastBar(initialLastBar);

    if (!isLive) {
      return;
    }

    const unsubscribe = subscribe(`ohlcv:${sessionId}:${symbol}`, (bar: OHLCVBarData) => {
      setBars((prev) => mergeBar(prev, bar));
      setLastBar(bar);
    });

    return unsubscribe;
  }, [initialBars, initialLastBar, isLive, sessionId, symbol, subscribe]);

  return { bars, lastBar, isConnected };
}
