import { useEffect, useMemo, useState } from "react";
import { useSimWebSocket } from "./useSimWebSocket";
import type {
	AgentDecisionEvent,
	AgentEvent,
	AgentFailedEvent,
	AgentSignal,
} from "#/types/sim";

const MAX_AGENT_EVENTS = 120;

export interface AgentLiveState {
	events: AgentEvent[];
	currentTranscript: string;
	isRunning: boolean;
	latestDecision: AgentDecisionEvent["decision"] | null;
	latestFailure: AgentFailedEvent | null;
	latestSignal: AgentSignal | null;
}

function defaultAgentLiveState(): AgentLiveState {
	return {
		events: [],
		currentTranscript: "",
		isRunning: false,
		latestDecision: null,
		latestFailure: null,
		latestSignal: null,
	};
}

export function useAgentMonitor(initialSelectedAgentId?: string) {
	const { subscribe, isConnected } = useSimWebSocket();
	const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
		initialSelectedAgentId,
	);
	const [liveStateByAgent, setLiveStateByAgent] = useState<
		Record<string, AgentLiveState>
	>({});
	const agentIds = useMemo(
		() => Object.keys(liveStateByAgent).sort((left, right) => left.localeCompare(right)),
		[liveStateByAgent],
	);

	useEffect(() => {
		if (!selectedAgentId && initialSelectedAgentId) {
			setSelectedAgentId(initialSelectedAgentId);
		}
	}, [initialSelectedAgentId, selectedAgentId]);

	useEffect(() => {
		if (!selectedAgentId && agentIds.length > 0) {
			setSelectedAgentId(agentIds[0]);
		}
	}, [agentIds, selectedAgentId]);

	useEffect(() => {
		const unsubscribe = subscribe("agents", (event: AgentEvent) => {
			setLiveStateByAgent((previous) => {
				const current = previous[event.agentId] ?? defaultAgentLiveState();
				const nextEvents = [...current.events, event].slice(-MAX_AGENT_EVENTS);

				switch (event.type) {
					case "run_started":
						return {
							...previous,
							[event.agentId]: {
								...current,
								events: nextEvents,
								currentTranscript: "",
								isRunning: true,
								latestFailure: null,
							},
						};
					case "thinking_delta":
						return {
							...previous,
							[event.agentId]: {
								...current,
								events: nextEvents,
								currentTranscript: event.transcript,
								isRunning: true,
							},
						};
					case "decision":
						return {
							...previous,
							[event.agentId]: {
								...current,
								events: nextEvents,
								currentTranscript: event.decision.reasoning,
								isRunning: false,
								latestDecision: event.decision,
								latestFailure: null,
							},
						};
					case "failed":
						return {
							...previous,
							[event.agentId]: {
								...current,
								events: nextEvents,
								currentTranscript: event.transcript,
								isRunning: false,
								latestFailure: event,
							},
						};
					case "signal":
						return {
							...previous,
							[event.agentId]: {
								...current,
								events: nextEvents,
								latestSignal: event.signal,
							},
						};
				}
			});
		});

		return unsubscribe;
	}, [subscribe]);

	const selectedLiveState = useMemo(() => {
		if (!selectedAgentId) {
			return null;
		}

		return liveStateByAgent[selectedAgentId] ?? defaultAgentLiveState();
	}, [liveStateByAgent, selectedAgentId]);

	return {
		isConnected,
		agentIds,
		selectedAgentId,
		setSelectedAgentId,
		liveStateByAgent,
		selectedLiveState,
	};
}
