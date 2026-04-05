import { useEffect, useState } from "react";
import type { AgentEvent } from "#/types/sim";
import { useSimWebSocket } from "./useSimWebSocket";

export function useAgentFeed(maxEvents: number = 50) {
	const { subscribe, isConnected } = useSimWebSocket();
	const [events, setEvents] = useState<AgentEvent[]>([]);

	useEffect(() => {
		const unsubscribe = subscribe("agents", (event: AgentEvent) => {
			setEvents((previous) => [event, ...previous].slice(0, maxEvents));
		});

		return unsubscribe;
	}, [maxEvents, subscribe]);

	return { events, isConnected };
}
