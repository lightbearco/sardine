import { RequestContext } from "@mastra/core/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveChatSessionId,
	type ChatRequestContextValues,
} from "#/mastra/chat-context";
import { eventInjectionTool } from "#/mastra/tools/eventInjectionTool";
import { unwrapToolResult } from "./test-helpers";

const insertSpy = vi.fn();

vi.mock("#/db/index", () => ({
	db: {
		insert: (...args: unknown[]) => insertSpy(...args),
	},
}));

describe("chat session context", () => {
	beforeEach(() => {
		insertSpy.mockReset();
	});

	it("resolves the session id from request context", () => {
		const requestContext = new RequestContext<ChatRequestContextValues>();
		requestContext.set("session-id", "sim_chat");

		expect(resolveChatSessionId({ requestContext })).toBe("sim_chat");
	});

	it("lets event injection fall back to request context instead of prompt text", async () => {
		const requestContext = new RequestContext<ChatRequestContextValues>();
		requestContext.set("session-id", "sim_chat");
		const insertedRows: Array<Record<string, unknown>> = [];

		insertSpy.mockReturnValue({
			values: (row: Record<string, unknown>) => ({
				returning: async () => {
					insertedRows.push(row);
					return [{ id: 42 }];
				},
			}),
		});

		const result = unwrapToolResult(
			await eventInjectionTool.execute?.(
				{
					type: "macro",
					title: "Rates shock",
					magnitude: -0.3,
					affectedSymbols: ["AAPL", "MSFT"],
				},
				{ requestContext },
			),
		);

		expect(result.commandId).toBe(42);
		expect(insertSpy).toHaveBeenCalledOnce();
		expect(insertedRows[0]?.sessionId).toBe("sim_chat");
	});
});
