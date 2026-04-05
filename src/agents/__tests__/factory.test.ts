import { describe, expect, it } from "vitest";
import { SIM_DEFAULTS } from "#/lib/constants";
import { TRADING_MODEL } from "#/mastra/models";
import {
	generateAgentConfigs,
	spawnAgents,
	spawnResearchAgents,
} from "../factory";

describe("generateAgentConfigs", () => {
	it("builds the canonical 50-agent distribution deterministically", () => {
		const configs = generateAgentConfigs(42, 50);

		expect(configs).toHaveLength(50);
		expect(configs.filter((config) => config.tier === "tier1")).toHaveLength(2);
		expect(configs.filter((config) => config.tier === "tier2")).toHaveLength(8);
		expect(configs.filter((config) => config.tier === "tier3")).toHaveLength(
			40,
		);

		expect(
			configs.filter((config) => config.strategy === "momentum"),
		).toHaveLength(15);
		expect(
			configs.filter((config) => config.strategy === "value"),
		).toHaveLength(10);
		expect(
			configs.filter((config) => config.strategy === "noise"),
		).toHaveLength(10);
		expect(
			configs.filter((config) => config.strategy === "depth-provider"),
		).toHaveLength(5);

		expect(configs[0]).toMatchObject({
			id: "goldman-sachs",
			name: "Goldman Sachs",
			tier: "tier1",
			model: TRADING_MODEL,
		});
		expect(configs[1]).toMatchObject({
			id: "citadel-securities",
			name: "Citadel Securities",
			tier: "tier1",
			model: TRADING_MODEL,
		});

		const personas = new Set(configs.map((config) => config.persona));
		expect(personas.size).toBe(50);

		const rerun = generateAgentConfigs(42, 50);
		expect(rerun).toEqual(configs);
	});

	it("respects a custom trader distribution", () => {
		const configs = generateAgentConfigs(42, 12, {
			groupCount: 3,
			traderDistribution: {
				tier1: 2,
				hedgeFund: 2,
				marketMaker: 1,
				pension: 1,
				momentum: 2,
				value: 2,
				noise: 1,
				depthProvider: 1,
			},
		});

		expect(configs).toHaveLength(12);
		expect(configs.filter((config) => config.tier === "tier1")).toHaveLength(2);
		expect(
			configs.filter((config) => config.entityType === "hedge-fund"),
		).toHaveLength(2);
		expect(
			configs.filter((config) => config.entityType === "market-maker"),
		).toHaveLength(2);
		expect(
			configs.filter((config) => config.entityType === "pension-fund"),
		).toHaveLength(1);
		expect(
			configs.filter((config) => config.strategy === "momentum"),
		).toHaveLength(2);
		expect(
			configs.filter((config) => config.strategy === "value"),
		).toHaveLength(2);
		expect(
			configs.filter((config) => config.strategy === "noise"),
		).toHaveLength(1);
		expect(
			configs.filter((config) => config.strategy === "depth-provider"),
		).toHaveLength(1);
		expect(new Set(configs.map((config) => config.llmGroup))).toEqual(
			new Set([0, 1, 2]),
		);
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
		expect(goldman?.requestContext.get("current-agenda")).toContain(
			"technology",
		);
		expect(goldman?.requestContext.get("investment-thesis")).toContain(
			"Late-cycle",
		);
		expect(goldman?.requestContext.get("constraints")).toContain(
			"Max 8% single-name position.",
		);
		expect(goldman?.requestContext.get("model-tier")).toBe("haiku");
		expect(goldman?.requestContext.get("max-position-pct")).toBe(0.08);
		expect(goldman?.requestContext.get("llm-group")).toBe(0);

		for (const entry of entries) {
			expect(entry.state.llmGroup).toBeGreaterThanOrEqual(0);
			expect(entry.state.llmGroup).toBeLessThan(SIM_DEFAULTS.groupCount);
		}
	});
});

describe("spawnResearchAgents", () => {
	it("creates the three configured research workers with unique request contexts", () => {
		const workers = spawnResearchAgents();

		expect(workers).toHaveLength(3);
		expect(workers.map((worker) => worker.focus)).toEqual([
			"news",
			"sentiment",
			"macro",
		]);

		for (const worker of workers) {
			expect(worker.sources.length).toBeGreaterThan(0);
			expect(worker.requestContext.get("agent-id")).toBe(worker.id);
			expect(worker.requestContext.get("agent-name")).toBe(worker.name);
			expect(worker.requestContext.get("research-focus")).toBe(worker.focus);
			expect(worker.requestContext.get("sources")).toEqual(worker.sources);
		}
	});
});
