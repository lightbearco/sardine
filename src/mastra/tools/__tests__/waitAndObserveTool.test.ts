import { RequestContext } from "@mastra/core/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRequestContextValues } from "#/mastra/chat-context";
import { waitAndObserveTool } from "#/mastra/tools/waitAndObserveTool";
import { unwrapToolResult } from "./test-helpers";

const selectSpy = vi.fn();

vi.mock("#/db/index", () => ({
	db: {
		select: (...args: unknown[]) => selectSpy(...args),
	},
}));

function createSelectChain(rows: unknown[]) {
	return {
		from: () => ({
			where: () => ({
				limit: async () => rows,
				orderBy: () => ({
					limit: async () => rows,
				}),
			}),
		}),
	};
}

describe("waitAndObserveTool", () => {
	beforeEach(() => {
		selectSpy.mockReset();
	});

	it("reports a queued command as pending before the world event row exists", async () => {
		const requestContext = new RequestContext<ChatRequestContextValues>();
		requestContext.set("session-id", "sim_chat");

		selectSpy
			.mockReturnValueOnce(createSelectChain([]))
			.mockReturnValueOnce(
				createSelectChain([
					{
						status: "pending",
						resultMessage: null,
						payload: {
							title: "US bombs Iran",
						},
					},
				]),
			)
			.mockReturnValueOnce(createSelectChain([{ currentTick: 4 }]));

		const result = unwrapToolResult(
			await waitAndObserveTool.execute?.(
				{
					eventId: "xaHOOxIY3xRC7yE-fVgkp",
				},
				{ requestContext },
			),
		);

		expect(result.eventStatus).toBe("pending");
		expect(result.eventTitle).toBe("US bombs Iran");
		expect(result.currentTick).toBe(4);
		expect(result.message).toContain("pending in the command queue");
	});
});
