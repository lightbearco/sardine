import { describe, expect, it } from "vitest";
import { resolveSelectedAgentId } from "../useAgentMonitor";

describe("resolveSelectedAgentId", () => {
	it("keeps the current selection when it is still valid", () => {
		expect(
			resolveSelectedAgentId({
				agentIds: ["agent-1", "agent-2"],
				selectedAgentId: "agent-2",
				initialSelectedAgentId: "agent-1",
			}),
		).toBe("agent-2");
	});

	it("resets to the first valid agent when the prior selection disappears", () => {
		expect(
			resolveSelectedAgentId({
				agentIds: ["agent-3"],
				selectedAgentId: "agent-2",
				initialSelectedAgentId: "agent-2",
			}),
		).toBe("agent-3");
	});

	it("returns undefined when the roster is empty", () => {
		expect(
			resolveSelectedAgentId({
				agentIds: [],
				selectedAgentId: "agent-2",
				initialSelectedAgentId: "agent-2",
			}),
		).toBeUndefined();
	});
});
