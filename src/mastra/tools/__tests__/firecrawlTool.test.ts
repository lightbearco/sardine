import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { unwrapToolResult } from "./test-helpers";

const originalEnv = process.env;

describe("firecrawlTool", () => {
	afterEach(() => {
		process.env = { ...originalEnv };
		vi.resetModules();
		vi.unmock("@mendable/firecrawl-js");
	});

	it("returns deterministic canned financial content in mock mode", async () => {
		process.env = {
			...originalEnv,
			FIRECRAWL_MOCK_MODE: "true",
		};

		const { firecrawlTool } = await import("#/mastra/tools/firecrawlTool");
		const result = unwrapToolResult(
			await firecrawlTool.execute?.(
				{
					url: "https://example.com/markets/story-1",
				},
				{} as never,
			),
		);

		expect(result.mock).toBe(true);
		expect(result.title.length).toBeGreaterThan(0);
		expect(result.symbols.length).toBeGreaterThan(0);
	});

	it("validates URLs with the tool input schema", async () => {
		const { firecrawlTool } = await import("#/mastra/tools/firecrawlTool");
		const inputSchema = firecrawlTool.inputSchema as z.ZodTypeAny;

		expect(() => inputSchema.parse({ url: "not-a-valid-url" })).toThrow();
	});

	it("surfaces Firecrawl failures cleanly in live mode", async () => {
		process.env = {
			...originalEnv,
			FIRECRAWL_MOCK_MODE: "false",
			FIRECRAWL_API_KEY: "fc-test-key",
		};

		vi.doMock("@mendable/firecrawl-js", () => ({
			default: class MockFirecrawlApp {
				async scrapeUrl() {
					return {
						success: false,
						error: "Request failed upstream",
					};
				}
			},
		}));

		const { firecrawlTool } = await import("#/mastra/tools/firecrawlTool");

		await expect(
			firecrawlTool.execute?.(
				{ url: "https://example.com/news/aapl" },
				{} as never,
			),
		).rejects.toThrow("Request failed upstream");
	});
});
