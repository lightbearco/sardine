import { useMemo } from "react";
import type { AgentEvent } from "#/types/sim";
import { useSessionDashboard, useSessionDashboardLiveState } from "./useSessionDashboard";

export function mergeAgentFeedEvents(
	previous: AgentEvent[],
	incoming: AgentEvent,
	maxEvents: number,
): AgentEvent[] {
	const deduped = previous.filter(
		(existing) => existing.eventId !== incoming.eventId,
	);
	return [incoming, ...deduped].slice(0, maxEvents);
}

export function useAgentFeed(maxEvents: number = 50) {
	const { isLive } = useSessionDashboard();
	const { agentEvents, isConnected } = useSessionDashboardLiveState();
	const events = useMemo(
		() => agentEvents.slice(-maxEvents).reverse(),
		[agentEvents, maxEvents],
	);

	return { events, isConnected, isLive };
}
