import { describe, expect, it } from "vitest";
import { isBlotterEvent } from "../Blotter";
import type { AgentEvent } from "#/types/sim";

describe("isBlotterEvent", () => {
	it("filters out run_started noise while keeping actionable events", () => {
		const runStarted: AgentEvent = {
			eventId: "event-1",
			type: "run_started",
			agentId: "agent-1",
			agentName: "Agent One",
			tick: 1,
		};
		const decision: AgentEvent = {
			eventId: "event-2",
			type: "decision",
			agentId: "agent-1",
			agentName: "Agent One",
			tick: 1,
			decision: {
				reasoning: "Stay long.",
				ordersPlaced: [],
				autopilotDirective: {
					standingOrders: [],
					holdPositions: ["AAPL"],
				},
			},
		};

		expect(isBlotterEvent(runStarted)).toBe(false);
		expect(isBlotterEvent(decision)).toBe(true);
	});
});
