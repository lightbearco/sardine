import { describe, expect, it } from "vitest";
import {
	mapResearchNoteRow,
	mergeResearchFeedNotes,
} from "../useResearchFeed";
import type { ResearchNote } from "#/types/research";

const initialNotes: ResearchNote[] = [
	{
		id: "note-1",
		agentId: "research-news",
		focus: "news",
		headline: "Apple suppliers guide to firmer demand",
		body: "Checks pointed to improved hardware demand into the next quarter.",
		sentiment: "bullish",
		confidence: 0.68,
		symbols: ["AAPL"],
		sources: ["https://example.com/apple"],
		publishedAtTick: 20,
		releasedToTier: "research",
	},
];

const liveNote: ResearchNote = {
	id: "note-2",
	agentId: "research-macro",
	focus: "macro",
	headline: "Treasury yields push higher after hawkish commentary",
	body: "Macro desks flagged valuation pressure for long-duration growth names.",
	sentiment: "bearish",
	confidence: 0.74,
	symbols: ["MSFT", "NVDA"],
	sources: ["https://example.com/fed"],
	publishedAtTick: 40,
	releasedToTier: "research",
};

describe("useResearchFeed helpers", () => {
	it("maps persisted research rows into the UI note shape", () => {
		const mapped = mapResearchNoteRow({
			id: 1,
			noteId: "note-1",
			sessionId: "session-1",
			agentId: "research-news",
			focus: "news",
			headline: "Apple suppliers guide to firmer demand",
			body: "Checks pointed to improved hardware demand into the next quarter.",
			sentiment: "bullish",
			confidence: 0.68,
			symbols: ["AAPL"],
			sources: ["https://example.com/apple"],
			publishedAtTick: 20,
			releasedToTier: "research",
			createdAt: new Date(),
		});

		expect(mapped).toEqual(initialNotes[0]);
	});

	it("prepends live research notes, dedupes by id, and caps the feed length", () => {
		const merged = mergeResearchFeedNotes(initialNotes, liveNote, 2);
		expect(merged[0]).toEqual(liveNote);
		expect(merged[1]).toEqual(initialNotes[0]);

		const deduped = mergeResearchFeedNotes(merged, liveNote, 2);
		expect(deduped).toHaveLength(2);
		expect(deduped[0]).toEqual(liveNote);
	});
});
