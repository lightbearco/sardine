import { describe, expect, it } from "vitest";
import { SIM_DEFAULTS } from "#/lib/constants";
import {
	getActiveGroupIndex,
	partitionAgentEntries,
	partitionAgents,
} from "../batch-scheduler";
import { generateAgentConfigs, spawnAgents } from "../factory";

describe("getActiveGroupIndex", () => {
	it("normalizes modulo for positive and negative ticks", () => {
		expect(getActiveGroupIndex(0, 10)).toBe(0);
		expect(getActiveGroupIndex(11, 10)).toBe(1);
		expect(getActiveGroupIndex(-1, 10)).toBe(9);
	});
});

describe("partitionAgents", () => {
	it("splits 50 spawned agents into the expected active and inactive groups", () => {
		const registry = spawnAgents(
			generateAgentConfigs(42, 50),
			SIM_DEFAULTS.groupCount,
		);

		const tickZero = partitionAgents(registry, 0, SIM_DEFAULTS.groupCount);
		expect(tickZero.active).toHaveLength(5);
		expect(tickZero.inactive).toHaveLength(45);
		expect(tickZero.active.every((agent) => agent.llmGroup === 0)).toBe(true);

		const tickThree = partitionAgents(registry, 3, SIM_DEFAULTS.groupCount);
		expect(tickThree.active).toHaveLength(5);
		expect(tickThree.inactive).toHaveLength(45);
		expect(tickThree.active.every((agent) => agent.llmGroup === 3)).toBe(true);
	});

	it("returns registry entries and skips paused agents", () => {
		const registry = spawnAgents(
			generateAgentConfigs(42, 10),
			SIM_DEFAULTS.groupCount,
		);

		const firstEntry = registry.getAll()[0];
		firstEntry.state.status = "paused";

		const partition = partitionAgentEntries(
			registry,
			0,
			SIM_DEFAULTS.groupCount,
		);

		expect(partition.active.every((entry) => entry.state.status === "active")).toBe(
			true,
		);
		expect(partition.inactive.every((entry) => entry.state.status === "active")).toBe(
			true,
		);
		expect(
			partition.active.some((entry) => entry.config.id === firstEntry.config.id),
		).toBe(false);
		expect(
			partition.inactive.some((entry) => entry.config.id === firstEntry.config.id),
		).toBe(false);
	});
});
