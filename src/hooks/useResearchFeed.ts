import { useMemo } from "react";
import type { ResearchNote } from "#/types/research";
import { researchNotes as researchNotesTable } from "#/db/schema";
import { useSessionDashboardLiveState } from "./useSessionDashboard";

type ResearchNoteRow = typeof researchNotesTable.$inferSelect;

export function mapResearchNoteRow(row: ResearchNoteRow): ResearchNote {
	return {
		id: row.noteId,
		agentId: row.agentId,
		focus: row.focus as ResearchNote["focus"],
		headline: row.headline,
		body: row.body,
		sentiment: row.sentiment,
		confidence: row.confidence,
		symbols: row.symbols ?? [],
		sources: row.sources ?? [],
		publishedAtTick: row.publishedAtTick,
		releasedToTier: row.releasedToTier,
	};
}

export function mergeResearchFeedNotes(
	previous: ResearchNote[],
	incoming: ResearchNote,
	maxNotes: number,
): ResearchNote[] {
	const deduped = previous.filter((existing) => existing.id !== incoming.id);
	return [incoming, ...deduped].slice(0, maxNotes);
}

export function useResearchFeed(maxNotes: number = 25) {
	const { isConnected, researchNotes } = useSessionDashboardLiveState();
	const notes = useMemo(
		() => researchNotes.slice(0, maxNotes),
		[maxNotes, researchNotes],
	);

	return {
		notes,
		isConnected,
	};
}
