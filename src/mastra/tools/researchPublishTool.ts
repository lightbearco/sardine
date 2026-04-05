import { createTool } from "@mastra/core/tools";
import { nanoid } from "nanoid";
import { z } from "zod";
import { researchNotes as researchNotesTable } from "#/db/schema";
import type { ResearchRequestContextValues } from "#/mastra/research-context";
import type { ResearchNote, Sentiment } from "#/types/research";

const researchPublishInputSchema = z.object({
	headline: z.string().min(5).max(280),
	body: z.string().min(20).max(4000),
	sentiment: z.enum(["bullish", "bearish", "neutral"]),
	confidence: z.number().min(0).max(1),
	symbols: z.array(z.string().min(1)).min(1).max(8),
	focus: z.enum(["news", "sentiment", "macro", "filings"]).optional(),
	sources: z.array(z.string().url()).min(1).max(5).optional(),
	sourceUrl: z.string().url().optional(),
});

const researchPublishOutputSchema = z.object({
	noteId: z.string(),
	headline: z.string(),
	publishedAtTick: z.number(),
	sentiment: z.enum(["bullish", "bearish", "neutral"]),
	confidence: z.number(),
	symbols: z.array(z.string()),
});

function normalizeSentiment(value: Sentiment): Sentiment {
	if (value === "bullish" || value === "bearish") {
		return value;
	}

	return "neutral";
}

function resolveSources(input: z.infer<typeof researchPublishInputSchema>): string[] {
	const values = [
		...(input.sources ?? []),
		...(input.sourceUrl ? [input.sourceUrl] : []),
	];

	return Array.from(new Set(values));
}

export const researchPublishTool = createTool<
	"research-publish",
	typeof researchPublishInputSchema,
	typeof researchPublishOutputSchema,
	undefined,
	undefined,
	ResearchRequestContextValues
>({
	id: "research-publish",
	description:
		"Publish a single structured research note, persist it, and enqueue it for tiered release to trading agents.",
	inputSchema: researchPublishInputSchema,
	outputSchema: researchPublishOutputSchema,
	execute: async (input, context) => {
		const requestContext = context?.requestContext;
		const publicationBus = requestContext?.get("publication-bus");
		const eventBus = requestContext?.get("event-bus");
		const db = requestContext?.get("db");
		const simTick = requestContext?.get("sim-tick");
		const agentId = requestContext?.get("agent-id");
		const sessionId = requestContext?.get("simulation-session-id");
		const focus = input.focus ?? requestContext?.get("research-focus");

		if (
			!requestContext ||
			!publicationBus ||
			!eventBus ||
			!db ||
			!agentId ||
			!sessionId
		) {
			throw new Error(
				"researchPublishTool requires publication-bus, event-bus, db, agent-id, and simulation-session-id in requestContext",
			);
		}

		if (simTick === undefined) {
			throw new Error("researchPublishTool requires sim-tick in requestContext");
		}

		if (!focus) {
			throw new Error(
				"researchPublishTool requires a research focus in input or requestContext",
			);
		}

		if (requestContext.get("published-research-note-id")) {
			throw new Error("Only one research note may be published per research cycle");
		}

		const noteId = nanoid();
		const note: ResearchNote = {
			id: noteId,
			agentId,
			focus,
			headline: input.headline.trim(),
			body: input.body.trim(),
			sentiment: normalizeSentiment(input.sentiment),
			confidence: Number(input.confidence.toFixed(3)),
			symbols: Array.from(new Set(input.symbols.map((symbol) => symbol.trim()))),
			sources: resolveSources(input),
			publishedAtTick: simTick,
			releasedToTier: "research",
		};

		publicationBus.publish(note);
		eventBus.emit("research-published", note);
		requestContext.set("published-research-note-id", note.id);
		requestContext.set("published-research-note", note);

		await db.insert(researchNotesTable).values({
			sessionId,
			noteId: note.id,
			publishedAtTick: note.publishedAtTick,
			agentId: note.agentId,
			focus: note.focus,
			headline: note.headline,
			body: note.body,
			sentiment: note.sentiment,
			confidence: note.confidence,
			symbols: note.symbols,
			sources: note.sources,
			releasedToTier: note.releasedToTier,
		});

		return {
			noteId: note.id,
			headline: note.headline,
			publishedAtTick: note.publishedAtTick,
			sentiment: note.sentiment,
			confidence: note.confidence,
			symbols: note.symbols,
		};
	},
});
