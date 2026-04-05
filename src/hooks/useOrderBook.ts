import { useState, useEffect } from "react";
import { useSimWebSocket } from "./useSimWebSocket";
import type { LOBSnapshot } from "#/types/market";

export function useOrderBook(
	symbol: string,
	initialSnapshot: LOBSnapshot | null = null,
) {
  const { subscribe, isConnected } = useSimWebSocket();
  const [snapshot, setSnapshot] = useState<LOBSnapshot | null>(initialSnapshot);

  useEffect(() => {
    if (!symbol) return;
    setSnapshot(initialSnapshot);
    
    const unsubscribe = subscribe(`lob:${symbol}`, (data: LOBSnapshot) => {
      setSnapshot(data);
    });

    return unsubscribe;
  }, [initialSnapshot, symbol, subscribe]);

  return { snapshot, isConnected };
}
