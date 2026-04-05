import { describe, expect, it } from "vitest";
import {
	applyAgentEventToLiveState,
	buildAgentLiveStateByAgent,
} from "../useAgentMonitor";
import type { AgentEvent, SessionAgentRosterEntry } from "#/types/sim";

const roster: SessionAgentRosterEntry[] = [
	{
		id: "agent-1",
		name: "Bridgewater",
		tier: "tier1",
		status: "active",
		entityType: "hedge-fund",
		strategyType: "macro",
		currentCash: 1_000_000,
		currentNav: 1_050_000,
		positions: {},
		lastAutopilotDirective: null,
		lastLlmAt: null,
		llmGroup: 0,
	},
];

const runStartedEvent: AgentEvent = {
	eventId: "event-1",
	type: "run_started",
	agentId: "agent-1",
	agentName: "Bridgewater",
	tick: 20,
};

const thinkingEvent: AgentEvent = {
	eventId: "event-2",
	type: "thinking_delta",
	agentId: "agent-1",
	agentName: "Bridgewater",
	tick: 20,
	delta: "Watching yields.",
	transcript: "Watching yields.",
};

const decisionEvent: AgentEvent = {
	eventId: "event-3",
	type: "decision",
	agentId: "agent-1",
	agentName: "Bridgewater",
	tick: 20,
	decision: {
		reasoning: "Higher yields pressure growth multiples.",
		ordersPlaced: [],
		autopilotDirective: {
			standingOrders: [],
			holdPositions: ["AAPL"],
		},
	},
};

describe("useAgentMonitor helpers", () => {
	it("seeds roster entries even before live events arrive", () => {
		const stateByAgent = buildAgentLiveStateByAgent(roster, []);
		expect(stateByAgent["agent-1"]).toMatchObject({
			agentName: "Bridgewater",
			isRunning: false,
		});
	});

	it("rebuilds live agent state from hydrated history", () => {
		const stateByAgent = buildAgentLiveStateByAgent(roster, [
			runStartedEvent,
			thinkingEvent,
			decisionEvent,
		]);

		expect(stateByAgent["agent-1"]).toMatchObject({
			agentName: "Bridgewater",
			isRunning: false,
			currentTranscript: "Higher yields pressure growth multiples.",
			latestDecision: decisionEvent.decision,
		});
		expect(stateByAgent["agent-1"]?.events).toHaveLength(3);
	});

	it("ignores duplicate websocket events after hydration", () => {
		const hydrated = buildAgentLiveStateByAgent(roster, [runStartedEvent]);
		const nextState = applyAgentEventToLiveState(
			hydrated["agent-1"],
			runStartedEvent,
		);

		expect(nextState).toBe(hydrated["agent-1"]);
	});
});
