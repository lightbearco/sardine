import { useState, useEffect } from "react";
import { useSimWebSocket } from "./useSimWebSocket";
import type { OHLCVBar } from "#/types/market";

export function useMarketData(
	symbol: string,
	initialLastBar: OHLCVBar | null = null,
) {
  const { subscribe, isConnected } = useSimWebSocket();
  const [bars, setBars] = useState<OHLCVBar[]>(
    initialLastBar ? [initialLastBar] : [],
  );
  const [lastBar, setLastBar] = useState<OHLCVBar | null>(initialLastBar);

  useEffect(() => {
    if (!symbol) return;
    
    // reset on symbol change
    setBars(initialLastBar ? [initialLastBar] : []);
    setLastBar(initialLastBar);

    const unsubscribe = subscribe(`ohlcv:${symbol}`, (bar: OHLCVBar) => {
      setBars((prev) => [...prev, bar]);
      setLastBar(bar);
    });

    return unsubscribe;
  }, [initialLastBar, symbol, subscribe]);

  return { bars, lastBar, isConnected };
}
