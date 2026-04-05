import { useEffect, useMemo, useState } from "react";
import { useSessionDashboard, useSessionDashboardLiveState } from "./useSessionDashboard";
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

export function resolveSelectedAgentId(input: {
	agentIds: string[];
	selectedAgentId: string | undefined;
	initialSelectedAgentId?: string;
}): string | undefined {
	const { agentIds, initialSelectedAgentId, selectedAgentId } = input;

	if (agentIds.length === 0) {
		return undefined;
	}

	if (selectedAgentId && agentIds.includes(selectedAgentId)) {
		return selectedAgentId;
	}

	if (initialSelectedAgentId && agentIds.includes(initialSelectedAgentId)) {
		return initialSelectedAgentId;
	}

	return agentIds[0];
}

export function useAgentMonitor(initialSelectedAgentId?: string) {
	const { isConnected, agentEvents } = useSessionDashboardLiveState();
	const { isLive, agentRoster } = useSessionDashboard();
	const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>(
		initialSelectedAgentId,
	);

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

	const liveStateByAgent = useMemo(
		() => buildAgentLiveStateByAgent(agentRoster, agentEvents),
		[agentEvents, agentRoster],
	);

	useEffect(() => {
		if (
			!selectedAgentId
			&& initialSelectedAgentId
			&& agentIds.includes(initialSelectedAgentId)
		) {
			setSelectedAgentId(initialSelectedAgentId);
		}
	}, [agentIds, initialSelectedAgentId, selectedAgentId]);

	useEffect(() => {
		const nextSelectedAgentId = resolveSelectedAgentId({
			agentIds,
			selectedAgentId,
			initialSelectedAgentId,
		});

		if (nextSelectedAgentId !== selectedAgentId) {
			setSelectedAgentId(nextSelectedAgentId);
		}
	}, [agentIds, initialSelectedAgentId, selectedAgentId]);

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
