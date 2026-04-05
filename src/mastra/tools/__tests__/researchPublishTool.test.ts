import { RequestContext } from "@mastra/core/request-context";
import { describe, expect, it, vi } from "vitest";
import { EventBus } from "#/engine/bus/EventBus";
import { PublicationBus } from "#/engine/bus/PublicationBus";
import type { ResearchRequestContextValues } from "#/mastra/research-context";
import { researchPublishTool } from "#/mastra/tools/researchPublishTool";
import { unwrapToolResult } from "./test-helpers";

function createResearchContext() {
	const requestContext = new RequestContext<ResearchRequestContextValues>();
	const publicationBus = new PublicationBus();
	const eventBus = new EventBus();
	const insertedRows: Record<string, unknown>[] = [];
	const db = {
		insert: () => ({
			values: async (value: Record<string, unknown>) => {
				insertedRows.push(value);
			},
		}),
	};

	requestContext.set("agent-id", "research-news");
	requestContext.set("agent-name", "Research News Desk");
	requestContext.set("research-focus", "news");
	requestContext.set("simulation-session-id", "test-session");
	requestContext.set("sources", ["https://example.com/news"]);
	requestContext.set("persona", "News desk persona");
	requestContext.set("sim-tick", 20);
	requestContext.set("publication-bus", publicationBus);
	requestContext.set("event-bus", eventBus);
	requestContext.set("db", db as never);

	return {
		requestContext,
		publicationBus,
		eventBus,
		insertedRows,
	};
}

describe("researchPublishTool", () => {
	it("publishes to the bus, persists the note, and emits an event", async () => {
		const { requestContext, publicationBus, eventBus, insertedRows } =
			createResearchContext();
		const publishedListener = vi.fn();
		eventBus.on("research-published", publishedListener);

		const result = unwrapToolResult(
			await researchPublishTool.execute?.(
				{
					headline: "Fed language turns more cautious on inflation progress",
					body: "Macro desks noted that rates-sensitive growth names may face renewed valuation pressure after the latest remarks.",
					sentiment: "bearish",
					confidence: 0.72,
					symbols: ["AAPL", "MSFT"],
					sources: [
						"https://www.federalreserve.gov/newsevents.htm",
						"https://www.cmegroup.com/markets/interest-rates.html",
					],
				},
				{ requestContext },
			),
		);

		expect(result.publishedAtTick).toBe(20);
		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]?.agentId).toBe("research-news");
		expect(publishedListener).toHaveBeenCalledOnce();

		const released = publicationBus.releaseDue(20);
		expect(released.tier1).toHaveLength(1);
		expect(released.tier1[0]?.headline).toContain("Fed language");
		expect(released.tier1[0]?.sources).toEqual([
			"https://www.federalreserve.gov/newsevents.htm",
			"https://www.cmegroup.com/markets/interest-rates.html",
		]);
	});

	it("rejects a second publication in the same cycle", async () => {
		const { requestContext } = createResearchContext();

		await researchPublishTool.execute?.(
			{
				headline: "First note",
				body: "This is the first actionable note of the cycle for testing purposes.",
				sentiment: "neutral",
				confidence: 0.55,
				symbols: ["AAPL"],
			},
			{ requestContext },
		);

		await expect(
			researchPublishTool.execute?.(
				{
					headline: "Second note",
					body: "This second note should be rejected because the cycle already published one note.",
					sentiment: "bullish",
					confidence: 0.61,
					symbols: ["MSFT"],
				},
				{ requestContext },
			),
		).rejects.toThrow("Only one research note may be published per research cycle");
	});
});
