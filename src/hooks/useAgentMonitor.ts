import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSimWebSocket } from "./useSimWebSocket";
import { useSessionDashboard } from "./useSessionDashboard";
import type {
	AgentDecisionEvent,
	AgentEvent,
	AgentFailedEvent,
	AgentSignal,
	SessionAgentRosterEntry,
} from "#/types/sim";

const MAX_AGENT_EVENTS = 120;

export interface AgentLiveState {
	agentName: string;
	status: SessionAgentRosterEntry["status"];
	events: AgentEvent[];
	currentTranscript: string;
	isRunning: boolean;
	latestDecision: AgentDecisionEvent["decision"] | null;
	latestFailure: AgentFailedEvent | null;
	latestSignal: AgentSignal | null;
}

function defaultAgentLiveState(agent?: SessionAgentRosterEntry): AgentLiveState {
	return {
		agentName: agent?.name ?? "",
		status: agent?.status ?? "active",
		events: [],
		currentTranscript: "",
		isRunning: false,
		latestDecision: null,
		latestFailure: null,
		latestSignal: null,
	};
}

export function applyAgentEventToLiveState(
	current: AgentLiveState,
	event: AgentEvent,
): AgentLiveState {
	if (current.events.some((existing) => existing.eventId === event.eventId)) {
		return current;
	}

	const nextEvents = [...current.events, event].slice(-MAX_AGENT_EVENTS);

	switch (event.type) {
		case "run_started":
			return {
				...current,
				agentName: event.agentName,
				events: nextEvents,
				currentTranscript: "",
				isRunning: true,
				latestFailure: null,
			};
		case "thinking_delta":
			return {
				...current,
				agentName: event.agentName,
				events: nextEvents,
				currentTranscript: event.transcript,
				isRunning: true,
			};
		case "decision":
			return {
				...current,
				agentName: event.agentName,
				events: nextEvents,
				currentTranscript: event.decision.reasoning,
				isRunning: false,
				latestDecision: event.decision,
				latestFailure: null,
			};
		case "failed":
			return {
				...current,
				agentName: event.agentName,
				events: nextEvents,
				currentTranscript: event.transcript,
				isRunning: false,
				latestFailure: event,
			};
		case "signal":
			return {
				...current,
				agentName: event.agentName,
				events: nextEvents,
				latestSignal: event.signal,
			};
	}
}

export function buildAgentLiveStateByAgent(
	agentRoster: SessionAgentRosterEntry[],
	agentEvents: AgentEvent[],
): Record<string, AgentLiveState> {
	const nextState = Object.fromEntries(
		agentRoster.map((agent) => [agent.id, defaultAgentLiveState(agent)]),
	);

	for (const event of agentEvents) {
		nextState[event.agentId] = applyAgentEventToLiveState(
			nextState[event.agentId] ?? defaultAgentLiveState(),
			event,
		);
	}

	return nextState;
}

export function useAgentMonitor(initialSelectedAgentId?: string) {
	const { subscribe, isConnected } = useSimWebSocket();
	const { isLive, sessionId, agentEvents, agentRoster } = useSessionDashboard();
	const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
		initialSelectedAgentId,
	);
	const liveStateRef = useRef<Record<string, AgentLiveState>>(
		buildAgentLiveStateByAgent(agentRoster, agentEvents),
	);
	const [liveStateVersion, setLiveStateVersion] = useState(0);

	const rosterById = useMemo(
		() => Object.fromEntries(agentRoster.map((agent) => [agent.id, agent])),
		[agentRoster],
	);
	const agentIds = useMemo(
		() =>
			agentRoster
				.map((agent) => agent.id)
				.sort((left, right) => left.localeCompare(right)),
		[agentRoster],
	);

	useEffect(() => {
		liveStateRef.current = buildAgentLiveStateByAgent(agentRoster, agentEvents);
		setLiveStateVersion((prev) => prev + 1);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [agentEvents, agentRoster]);

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

	const handleAgentEvent = useCallback(
		(event: AgentEvent) => {
			const rosterEntry = rosterById[event.agentId];
			const current =
				liveStateRef.current[event.agentId] ?? defaultAgentLiveState(rosterEntry);
			const nextState = applyAgentEventToLiveState(current, event);
			if (nextState === current) {
				return;
			}

			liveStateRef.current = {
				...liveStateRef.current,
				[event.agentId]: nextState,
			};
			setLiveStateVersion((prev) => prev + 1);
		},
		[rosterById],
	);

	useEffect(() => {
		if (!isLive) {
			return;
		}

		const unsubscribe = subscribe(`agents:${sessionId}`, handleAgentEvent);
		return unsubscribe;
	}, [handleAgentEvent, isLive, sessionId, subscribe]);

	const liveStateByAgent = useMemo(
		() => liveStateRef.current,
		[liveStateVersion],
	);

	const selectedLiveState = useMemo(() => {
		if (!selectedAgentId) {
			return null;
		}

		const rosterEntry = rosterById[selectedAgentId];
		return liveStateByAgent[selectedAgentId] ?? defaultAgentLiveState(rosterEntry);
	}, [liveStateByAgent, rosterById, selectedAgentId]);

	return {
		isConnected,
		isLive,
		agentIds,
		selectedAgentId,
		setSelectedAgentId,
		liveStateByAgent,
		selectedLiveState,
	};
}
