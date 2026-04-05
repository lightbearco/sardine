import { describe, expect, it } from "vitest";
import {
	buildDefaultTraderDistribution,
	buildSessionSymbols,
	createSimulationSessionInputSchema,
	deriveGroupCount,
	sumTraderDistribution,
} from "#/lib/simulation-session";

describe("simulation-session helpers", () => {
	it("builds a default trader distribution that matches the agent count", () => {
		const distribution = buildDefaultTraderDistribution(50);

		expect(sumTraderDistribution(distribution)).toBe(50);
		expect(distribution.tier1).toBe(2);
		expect(distribution.momentum).toBe(15);
		expect(distribution.value).toBe(10);
	});

	it("derives group count from active group size", () => {
		expect(deriveGroupCount(50, 5)).toBe(10);
		expect(deriveGroupCount(51, 5)).toBe(11);
	});

	it("builds session symbols from the configured symbol count", () => {
		expect(buildSessionSymbols(3)).toEqual(["AAPL", "MSFT", "AMZN"]);
	});

	it("validates trader distribution totals", () => {
		expect(() =>
			createSimulationSessionInputSchema.parse({
				symbolCount: 3,
				agentCount: 10,
				activeGroupSize: 5,
				tickIntervalMs: 1000,
				simulatedTickDuration: 5,
				traderDistribution: {
					tier1: 2,
					hedgeFund: 1,
					marketMaker: 1,
					pension: 1,
					momentum: 1,
					value: 1,
					noise: 1,
					depthProvider: 1,
				},
			}),
		).toThrow("Trader distribution must add up to agentCount");
	});
});
