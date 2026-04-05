import { beforeEach, describe, expect, it, vi } from "vitest";

const selectQueue: unknown[][] = [];
const insertValues = vi.fn();
const updateMock = vi.fn();

function queueSelectResult(result: unknown[]) {
	selectQueue.push(result);
}

function dequeueSelectResult() {
	const next = selectQueue.shift();
	if (!next) {
		throw new Error("No queued select result for mock db");
	}

	return next;
}

function createSelectQuery(result: unknown[]) {
	const query = {
		from: () => query,
		where: () => query,
		orderBy: () => query,
		limit: () => Promise.resolve(result),
		then: (onFulfilled: (value: unknown[]) => unknown) =>
			Promise.resolve(onFulfilled(result)),
	};

	return query;
}

vi.mock("#/db/index", () => ({
	db: {
		select: vi.fn(() => createSelectQuery(dequeueSelectResult())),
		insert: vi.fn(() => ({
			values: insertValues,
		})),
		update: updateMock,
	},
}));

describe("session queueing", () => {
	beforeEach(() => {
		selectQueue.length = 0;
		insertValues.mockReset();
		updateMock.mockReset();
	});

	it("creates a new session without completing other live sessions", async () => {
		const { createSimulationSession } = await import("../sessions");

		insertValues.mockResolvedValue(undefined);

		const result = await createSimulationSession({
			symbolCount: 4,
			agentCount: 20,
			activeGroupSize: 5,
			tickIntervalMs: 1000,
			simulatedTickDuration: 5,
			traderDistribution: {
				tier1: 1,
				hedgeFund: 2,
				marketMaker: 2,
				pension: 1,
				momentum: 6,
				value: 4,
				noise: 2,
				depthProvider: 2,
			},
		});

		expect(result.sessionId).toMatch(/^sim_/);
		expect(insertValues).toHaveBeenCalledTimes(1);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it("lists active sessions ahead of queued sessions", async () => {
		queueSelectResult([
			{
				id: "pending-2",
				status: "pending",
				updatedAt: new Date("2026-04-05T11:00:00.000Z"),
				createdAt: new Date("2026-04-05T11:00:00.000Z"),
			},
			{
				id: "active-1",
				status: "active",
				updatedAt: new Date("2026-04-05T10:00:00.000Z"),
				createdAt: new Date("2026-04-05T10:00:00.000Z"),
			},
			{
				id: "pending-1",
				status: "pending",
				updatedAt: new Date("2026-04-05T09:00:00.000Z"),
				createdAt: new Date("2026-04-05T09:00:00.000Z"),
			},
		]);

		const { listRunnableSimulationSessions } = await import("../sessions");
		const sessions = await listRunnableSimulationSessions();

		expect(sessions.map((session) => session.id)).toEqual([
			"active-1",
			"pending-2",
			"pending-1",
		]);
	});
});
