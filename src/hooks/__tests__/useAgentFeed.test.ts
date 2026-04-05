import { describe, expect, it } from "vitest";
import { mergeAgentFeedEvents } from "../useAgentFeed";
import type { AgentEvent } from "#/types/sim";

const initialEvent: AgentEvent = {
	eventId: "event-1",
	type: "signal",
	agentId: "agent-1",
	agentName: "Agent One",
	tick: 1,
	signal: {
		agentId: "agent-1",
		agentName: "Agent One",
		side: "buy",
		symbol: "AAPL",
		price: 150,
		qty: 10,
		reasoning: "Opening starter position.",
		tick: 1,
	},
};

const nextEvent: AgentEvent = {
	eventId: "event-2",
	type: "decision",
	agentId: "agent-1",
	agentName: "Agent One",
	tick: 2,
	decision: {
		reasoning: "Upside momentum remains intact.",
		ordersPlaced: [],
		autopilotDirective: {
			standingOrders: [],
			holdPositions: ["AAPL"],
		},
	},
};

describe("useAgentFeed helpers", () => {
	it("prepends live events and dedupes by event id", () => {
		const merged = mergeAgentFeedEvents([initialEvent], nextEvent, 5);
		expect(merged).toEqual([nextEvent, initialEvent]);

		const deduped = mergeAgentFeedEvents(merged, nextEvent, 5);
		expect(deduped).toEqual([nextEvent, initialEvent]);
	});

	it("caps the feed length", () => {
		const merged = mergeAgentFeedEvents([initialEvent], nextEvent, 1);
		expect(merged).toEqual([nextEvent]);
	});
});
