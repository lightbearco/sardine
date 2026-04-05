// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("#/hooks/useAgentMonitor", () => ({
	useAgentMonitor: () => ({
		agentIds: ["agent-1"],
		isConnected: false,
		isLive: false,
		liveStateByAgent: {
			"agent-1": {
				agentName: "Bridgewater",
				status: "active",
				events: [],
				currentTranscript: "",
				isRunning: false,
				latestDecision: null,
				latestFailure: null,
				latestSignal: null,
			},
		},
		selectedAgentId: "agent-1",
		selectedLiveState: {
			agentName: "Bridgewater",
			status: "active",
			events: [],
			currentTranscript: "",
			isRunning: false,
			latestDecision: null,
			latestFailure: null,
			latestSignal: null,
		},
		setSelectedAgentId: vi.fn(),
	}),
}));

describe("AgentsPanel", () => {
	it("renders the persisted roster name even when no live events have arrived", async () => {
		const { AgentsPanel } = await import("../AgentsPanel");
		render(<AgentsPanel />);

		expect(screen.getAllByText("Bridgewater").length).toBeGreaterThan(0);
		expect(screen.getByText("No transcript yet.")).toBeTruthy();
		expect(screen.getByText("No decision yet.")).toBeTruthy();
	});
});
