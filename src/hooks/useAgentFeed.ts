import { useState, useEffect } from "react";
import { useSimWebSocket } from "./useSimWebSocket";
import type { AgentSignal } from "#/types/sim";

export function useAgentFeed(maxDecisions: number = 50) {
  const { subscribe, isConnected } = useSimWebSocket();
  const [decisions, setDecisions] = useState<AgentSignal[]>([]);

  useEffect(() => {
    const unsubscribe = subscribe("agents", (decision: AgentSignal) => {
      setDecisions((prev) => {
        const next = [decision, ...prev];
        if (next.length > maxDecisions) {
          return next.slice(0, maxDecisions);
        }
        return next;
      });
    });

    return unsubscribe;
  }, [subscribe, maxDecisions]);

  return { decisions, isConnected };
}
