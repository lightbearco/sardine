import { useState, useEffect } from "react";
import type { LOBSnapshotData } from "#/types/market";
import { useSessionDashboard } from "./useSessionDashboard";
import { useSimWebSocket } from "./useSimWebSocket";

export function useOrderBook(symbol: string) {
  const { subscribe, isConnected } = useSimWebSocket();
  const {
	sessionId,
	isLive,
	symbol: selectedSymbol,
	snapshot: selectedSnapshot,
	watchlist,
  } = useSessionDashboard();
  const initialSnapshot =
	symbol === selectedSymbol
		? selectedSnapshot
		: watchlist[symbol]?.snapshot ?? null;
  const [snapshot, setSnapshot] = useState<LOBSnapshotData | null>(initialSnapshot);

  useEffect(() => {
    if (!symbol) return;
    setSnapshot(initialSnapshot);

    if (!isLive) {
      return;
    }

    const unsubscribe = subscribe(`lob:${sessionId}:${symbol}`, (data: LOBSnapshotData) => {
      setSnapshot(data);
    });

    return unsubscribe;
  }, [initialSnapshot, isLive, sessionId, symbol, subscribe]);

  return { snapshot, isConnected };
}
