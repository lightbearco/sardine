import { useState, useEffect } from "react";
import { useSimWebSocket } from "./useSimWebSocket";
import type { LOBSnapshot } from "#/types/market";

export function useOrderBook(symbol: string) {
  const { subscribe, isConnected } = useSimWebSocket();
  const [snapshot, setSnapshot] = useState<LOBSnapshot | null>(null);

  useEffect(() => {
    if (!symbol) return;
    setSnapshot(null);
    
    const unsubscribe = subscribe(`lob:${symbol}`, (data: LOBSnapshot) => {
      setSnapshot(data);
    });

    return unsubscribe;
  }, [symbol, subscribe]);

  return { snapshot, isConnected };
}
