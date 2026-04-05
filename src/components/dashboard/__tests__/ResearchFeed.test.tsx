// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResearchNote } from "#/types/research";

const notes: ResearchNote[] = [
	{
		id: "note-1",
		agentId: "research-news",
		focus: "news",
		headline: "Apple suppliers guide to firmer demand",
		body: "Checks pointed to improved hardware demand into the next quarter.",
		sentiment: "bullish",
		confidence: 0.68,
		symbols: ["AAPL", "MSFT"],
		sources: ["https://example.com/apple", "https://example.com/channel-check"],
		publishedAtTick: 20,
		releasedToTier: "research",
	},
];

vi.mock("#/hooks/useResearchFeed", () => ({
	useResearchFeed: () => ({
		notes,
		isConnected: true,
	}),
}));

describe("ResearchFeed", () => {
	it("renders headline, sentiment, confidence, and affected symbols", async () => {
		const { ResearchFeed } = await import("../ResearchFeed");
		render(<ResearchFeed />);

		expect(
			screen.getByText("Apple suppliers guide to firmer demand"),
		).toBeTruthy();
		expect(screen.getByText("bullish")).toBeTruthy();
		expect(screen.getByText("Conf 68%")).toBeTruthy();
		expect(screen.getByText("AAPL")).toBeTruthy();
		expect(screen.getByText("MSFT")).toBeTruthy();
		expect(screen.getByText(/news/i)).toBeTruthy();
	});
});
