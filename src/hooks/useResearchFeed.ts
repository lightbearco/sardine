import { useCallback, useEffect, useRef, useState } from "react";
import type { ResearchNote } from "#/types/research";
import { researchNotes as researchNotesTable } from "#/db/schema";
import { useSimWebSocket } from "./useSimWebSocket";
import { useSessionDashboard } from "./useSessionDashboard";

type ResearchNoteRow = typeof researchNotesTable.$inferSelect;

const raf =
	typeof requestAnimationFrame !== "undefined"
		? requestAnimationFrame
		: (cb: FrameRequestCallback) => setTimeout(cb, 16);
const caf =
	typeof cancelAnimationFrame !== "undefined"
		? cancelAnimationFrame
		: (handle: number) => clearTimeout(handle);

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
	const { subscribe, isConnected } = useSimWebSocket();
	const { isLive, researchNotes: initialNotes, sessionId } = useSessionDashboard();
	const [notes, setNotes] = useState<ResearchNote[]>(initialNotes.slice(0, maxNotes));
	const queueRef = useRef<ResearchNote[]>([]);
	const frameRef = useRef<number | null>(null);

	const flushQueue = useCallback(() => {
		frameRef.current = null;
		const incoming = queueRef.current.splice(0);
		if (incoming.length === 0) {
			return;
		}

		setNotes((previous) => {
			let next = previous;
			for (const note of incoming) {
				next = mergeResearchFeedNotes(next, note, maxNotes);
			}
			return next;
		});

		if (queueRef.current.length > 0) {
			frameRef.current = raf(flushQueue);
		}
	}, [maxNotes]);

	useEffect(() => {
		setNotes(initialNotes.slice(0, maxNotes));
	}, [initialNotes, maxNotes]);

	useEffect(() => {
		if (!isLive) {
			return;
		}

		const unsubscribe = subscribe(`research:${sessionId}`, (note: ResearchNote) => {
			queueRef.current.push(note);
			if (frameRef.current === null) {
				frameRef.current = raf(flushQueue);
			}
		});

		return () => {
			unsubscribe();
			if (frameRef.current !== null) {
				caf(frameRef.current);
				frameRef.current = null;
			}
			queueRef.current.splice(0);
		};
	}, [flushQueue, isLive, maxNotes, sessionId, subscribe]);

	return {
		notes,
		isConnected,
	};
}
