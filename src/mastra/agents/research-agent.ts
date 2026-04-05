import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { RESEARCH_MODEL } from "#/mastra/models";
import { firecrawlTool } from "#/mastra/tools/firecrawlTool";
import { researchPublishTool } from "#/mastra/tools/researchPublishTool";

export const researchCycleResultSchema = z.object({
	reasoning: z.string(),
	published: z.boolean(),
	noteId: z.string().optional(),
	sourceUrls: z.array(z.string()).optional(),
});

function listSources(sources: string[]): string {
	if (sources.length === 0) {
		return "- No sources configured.";
	}

	return sources.map((source) => `- ${source}`).join("\n");
}

function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	return value.filter((item): item is string => typeof item === "string");
}

export const researchAgent = new Agent({
	id: "research-agent",
	name: "Research Agent",
	description:
		"A shared Mastra research agent template that synthesizes source material into publishable research notes.",
	instructions: ({ requestContext }) => {
		const focus = requestContext?.get("research-focus") ?? "news";
		const persona =
			requestContext?.get("persona") ??
			"You are a financial research analyst.";
		const sources =
			asStringArray(requestContext?.get("sources")) ?? [];

		return `
${persona}

## Coverage Focus
You are responsible for ${focus} research.

## Assigned Sources
${listSources(sources)}

## Operating Rules
- Scrape source material with firecrawlTool before publishing anything.
- Publish at most one research note per cycle.
- Only publish when the source contains actionable information for trading agents.
- Keep the note specific, concise, and tied to the affected symbols.
- Prefer confidence below 0.7 when the signal is ambiguous or indirect.

## Response Contract
Return a structured object with:
1. \`reasoning\`: 2-3 sentences explaining what you found.
2. \`published\`: whether you published a note this cycle.
3. \`noteId\`: include the published note ID when a note was created.
4. \`sourceUrls\`: always return an array of source URL strings you relied on; use \`[]\` when none were used.
`.trim();
	},
	model: RESEARCH_MODEL,
	tools: {
		firecrawlTool,
		researchPublishTool,
	},
});
