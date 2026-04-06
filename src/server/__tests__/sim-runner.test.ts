import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Decimal from "decimal.js";
import { spawnResearchAgents } from "#/agents/factory";
import { EventBus } from "#/engine/bus/EventBus";
import { PublicationBus } from "#/engine/bus/PublicationBus";

vi.mock("#/db/index", () => ({
	db: {},
}));

describe("sim-runner research scheduling", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("only runs research on ticks divisible by the configured frequency", async () => {
		const { runResearchCycle, shouldRunResearchCycle } = await import(
			"../sim-runner"
		);
		const workers = spawnResearchAgents();
		const generate = vi.fn().mockResolvedValue({
			object: {
				reasoning: "Nothing actionable this cycle.",
				published: false,
			},
		});

		expect(shouldRunResearchCycle(19)).toBe(false);
		expect(shouldRunResearchCycle(20)).toBe(true);
		expect(shouldRunResearchCycle(9, 10)).toBe(false);
		expect(shouldRunResearchCycle(10, 10)).toBe(true);

		await runResearchCycle(
			workers,
			19,
			new PublicationBus(),
			new EventBus(),
			"test-session",
			{ generate },
		);
		expect(generate).not.toHaveBeenCalled();

		await runResearchCycle(
			workers,
			20,
			new PublicationBus(),
			new EventBus(),
			"test-session",
			{ generate },
		);
		expect(generate).toHaveBeenCalledTimes(3);
	}, 10000);

	it("continues the cycle when one research worker fails", async () => {
		const { runResearchCycle } = await import("../sim-runner");
		const workers = spawnResearchAgents();
		const generate = vi
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValue({
				object: {
					reasoning: "Published or skipped.",
					published: false,
				},
			});

		await expect(
			runResearchCycle(
				workers,
				20,
				new PublicationBus(),
				new EventBus(),
				"test-session",
				{ generate },
			),
		).resolves.toBeUndefined();
		expect(generate).toHaveBeenCalledTimes(3);
	});

	it("builds divergence rows from sim and real prices", async () => {
		const { buildDivergenceRows } = await import("../sim-runner");

		const rows = buildDivergenceRows({
			sessionId: "test-session",
			tick: 61,
			referencePrices: new Map([
				["AAPL", new Decimal(110)],
				["MSFT", new Decimal(95)],
			]),
			quotes: new Map([
				[
					"AAPL",
					{ lastPrice: 100, midPrice: null, bidPrice: null, askPrice: null },
				],
				[
					"MSFT",
					{ lastPrice: null, midPrice: null, bidPrice: null, askPrice: null },
				],
			]),
		});

		expect(rows).toEqual([
			{
				tick: 61,
				symbol: "AAPL",
				simPrice: 110,
				realPrice: 100,
				divergencePct: 10,
			},
		]);
	});

	it("defaults the live session cap to two and sanitizes invalid values", async () => {
		const { getMaxLiveSessions } = await import("../sim-runner");

		expect(getMaxLiveSessions({} as NodeJS.ProcessEnv)).toBe(2);
		expect(
			getMaxLiveSessions({
				SIM_MAX_LIVE_SESSIONS: "5",
			} as NodeJS.ProcessEnv),
		).toBe(5);
		expect(
			getMaxLiveSessions({
				SIM_MAX_LIVE_SESSIONS: "0",
			} as NodeJS.ProcessEnv),
		).toBe(2);
	});

	it("only bootstraps pending sessions up to the available runtime capacity", async () => {
		const { selectPendingSessionsToBootstrap } = await import("../sim-runner");

		const sessions = [
			{ id: "active-1", status: "active" },
			{ id: "pending-1", status: "pending" },
			{ id: "pending-2", status: "pending" },
			{ id: "pending-3", status: "pending" },
		] as const;

		expect(
			selectPendingSessionsToBootstrap({
				sessions: [...sessions] as never[],
				loadedRuntimeIds: ["active-1"],
				maxLiveSessions: 2,
			}).map((session) => session.id),
		).toEqual(["pending-1"]);

		expect(
			selectPendingSessionsToBootstrap({
				sessions: [...sessions] as never[],
				loadedRuntimeIds: ["active-1", "pending-1"],
				maxLiveSessions: 2,
			}),
		).toEqual([]);
	});

	it("resumes unloaded active sessions before considering queued sessions", async () => {
		const { selectActiveSessionsToResume, selectPendingSessionsToBootstrap } =
			await import("../sim-runner");

		const sessions = [
			{ id: "active-1", status: "active" },
			{ id: "active-2", status: "active" },
			{ id: "pending-1", status: "pending" },
		] as const;

		expect(
			selectActiveSessionsToResume({
				sessions: [...sessions] as never[],
				loadedRuntimeIds: [],
				maxLiveSessions: 2,
			}).map((session) => session.id),
		).toEqual(["active-1", "active-2"]);

		expect(
			selectPendingSessionsToBootstrap({
				sessions: [...sessions] as never[],
				loadedRuntimeIds: ["active-1", "active-2"],
				maxLiveSessions: 2,
			}),
		).toEqual([]);
	});
});
