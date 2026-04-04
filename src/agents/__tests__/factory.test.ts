import { describe, expect, it } from "vitest";
import { SIM_DEFAULTS } from "#/lib/constants";
import { generateAgentConfigs, spawnAgents } from "../factory";

describe("generateAgentConfigs", () => {
	it("builds the canonical 50-agent distribution deterministically", () => {
		const configs = generateAgentConfigs(42, 50);

		expect(configs).toHaveLength(50);
		expect(configs.filter((config) => config.tier === "tier1")).toHaveLength(2);
		expect(configs.filter((config) => config.tier === "tier2")).toHaveLength(8);
		expect(configs.filter((config) => config.tier === "tier3")).toHaveLength(40);

		expect(
			configs.filter((config) => config.strategy === "momentum"),
		).toHaveLength(15);
		expect(configs.filter((config) => config.strategy === "value")).toHaveLength(10);
		expect(configs.filter((config) => config.strategy === "noise")).toHaveLength(10);
		expect(
			configs.filter((config) => config.strategy === "depth-provider"),
		).toHaveLength(5);

		expect(configs[0]).toMatchObject({
			id: "goldman-sachs",
			name: "Goldman Sachs",
			tier: "tier1",
			model: "google/gemini-2.5-pro",
		});
		expect(configs[1]).toMatchObject({
			id: "citadel-securities",
			name: "Citadel Securities",
			tier: "tier1",
			model: "google/gemini-2.5-pro",
		});

		const personas = new Set(configs.map((config) => config.persona));
		expect(personas.size).toBe(50);

		const rerun = generateAgentConfigs(42, 50);
		expect(rerun).toEqual(configs);
	});
});

describe("spawnAgents", () => {
	it("registers agents with populated request context and runtime state", () => {
		const configs = generateAgentConfigs(42, 50);
		const registry = spawnAgents(configs, SIM_DEFAULTS.groupCount);
		const entries = registry.getAll();

		expect(entries).toHaveLength(50);

		const goldman = registry.get("goldman-sachs");
		expect(goldman).toBeDefined();
		expect(goldman?.state.cash.eq(5_000_000)).toBe(true);
		expect(goldman?.state.nav.eq(5_000_000)).toBe(true);
		expect(goldman?.state.openOrders.size).toBe(0);
		expect(goldman?.requestContext.get("agent-name")).toBe("Goldman Sachs");
		expect(goldman?.requestContext.get("current-agenda")).toContain("technology");
		expect(goldman?.requestContext.get("investment-thesis")).toContain("Late-cycle");
		expect(goldman?.requestContext.get("constraints")).toContain(
			"Max 8% single-name position.",
		);
		expect(goldman?.requestContext.get("model-tier")).toBe("sonnet");
		expect(goldman?.requestContext.get("max-position-pct")).toBe(0.08);
		expect(goldman?.requestContext.get("llm-group")).toBe(0);

		for (const entry of entries) {
			expect(entry.state.llmGroup).toBeGreaterThanOrEqual(0);
			expect(entry.state.llmGroup).toBeLessThan(SIM_DEFAULTS.groupCount);
		}
	});
});
