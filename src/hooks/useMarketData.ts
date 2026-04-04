import { useState, useEffect } from "react";
import { useSimWebSocket } from "./useSimWebSocket";
import type { OHLCVBar } from "#/types/market";

export function useMarketData(symbol: string) {
  const { subscribe, isConnected } = useSimWebSocket();
  const [bars, setBars] = useState<OHLCVBar[]>([]);
  const [lastBar, setLastBar] = useState<OHLCVBar | null>(null);

  useEffect(() => {
    if (!symbol) return;
    
    // reset on symbol change
    setBars([]);
    setLastBar(null);

    const unsubscribe = subscribe(`ohlcv:${symbol}`, (bar: OHLCVBar) => {
      setBars((prev) => [...prev, bar]);
      setLastBar(bar);
    });

    return unsubscribe;
  }, [symbol, subscribe]);

  return { bars, lastBar, isConnected };
}
