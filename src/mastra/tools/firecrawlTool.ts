import FirecrawlApp from "@mendable/firecrawl-js";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { DEV_TICKERS } from "#/lib/constants";

const KNOWN_SYMBOLS = new Set(DEV_TICKERS.map((ticker) => ticker.symbol));

const cannedResearchStories = [
	{
		title: "Mega-cap tech lifts after cloud demand commentary improves",
		markdown:
			"Analysts pointed to stronger enterprise cloud bookings and steadier AI infrastructure demand. Apple (AAPL) and Microsoft (MSFT) were both cited as relative winners while broader risk appetite improved.",
		source: "Mock Market Wire",
		publishedAt: "2026-04-05T08:30:00.000Z",
	},
	{
		title: "Traders grow cautious as rate path uncertainty pressures sentiment",
		markdown:
			"Cross-asset desks described a defensive tone into the open as investors reassessed the timing of future Fed cuts. Financials were mixed while growth exposure in NVDA and AMZN saw more volatile positioning.",
		source: "Mock Macro Desk",
		publishedAt: "2026-04-05T09:00:00.000Z",
	},
	{
		title: "Macro desks flag softer industrial demand and selective energy strength",
		markdown:
			"Forward commentary suggested softer industrial order momentum but stable energy cash-flow expectations. XOM, CVX, CAT, and GE remained in focus for macro-sensitive flows.",
		source: "Mock Cross-Asset Brief",
		publishedAt: "2026-04-05T09:15:00.000Z",
	},
] as const;

const firecrawlInputSchema = z.object({
	url: z.string().url(),
});

const firecrawlOutputSchema = z.object({
	url: z.string().url(),
	title: z.string(),
	markdown: z.string(),
	excerpt: z.string(),
	publishedAt: z.string().nullable(),
	source: z.string().nullable(),
	symbols: z.array(z.string()),
	mock: z.boolean(),
});

function shouldUseMockMode(): boolean {
	const mockFlag = process.env.FIRECRAWL_MOCK_MODE;
	if (mockFlag === "true") {
		return true;
	}

	return !process.env.FIRECRAWL_API_KEY;
}

function extractSymbols(content: string): string[] {
	const matches = content.toUpperCase().match(/\b[A-Z]{1,5}\b/g) ?? [];
	return Array.from(
		new Set(matches.filter((candidate) => KNOWN_SYMBOLS.has(candidate))),
	).slice(0, 8);
}

function buildExcerpt(markdown: string): string {
	const normalized = markdown.replace(/\s+/g, " ").trim();
	return normalized.slice(0, 280);
}

function createMockResponse(url: string) {
	const story =
		cannedResearchStories[
			Math.abs(
				Array.from(url).reduce(
					(accumulator, character) => accumulator + character.charCodeAt(0),
					0,
				),
			) % cannedResearchStories.length
		];

	return {
		url,
		title: story.title,
		markdown: story.markdown,
		excerpt: buildExcerpt(story.markdown),
		publishedAt: story.publishedAt,
		source: story.source,
		symbols: extractSymbols(`${story.title} ${story.markdown}`),
		mock: true,
	};
}

export const firecrawlTool = createTool<
	"firecrawl-scrape",
	typeof firecrawlInputSchema,
	typeof firecrawlOutputSchema
>({
	id: "firecrawl-scrape",
	description:
		"Scrape a source URL and return structured financial-news content for downstream research synthesis.",
	inputSchema: firecrawlInputSchema,
	outputSchema: firecrawlOutputSchema,
	execute: async ({ url }) => {
		if (shouldUseMockMode()) {
			return createMockResponse(url);
		}

		const apiKey = process.env.FIRECRAWL_API_KEY;
		if (!apiKey) {
			throw new Error(
				"firecrawlTool requires FIRECRAWL_API_KEY when mock mode is disabled",
			);
		}

		const client = new FirecrawlApp({ apiKey });
		const response = await client.scrapeUrl(url, {
			formats: ["markdown"],
		});

		if (!response.success) {
			throw new Error(response.error ?? `Firecrawl failed to scrape ${url}`);
		}

		const markdown = response.markdown?.trim();
		if (!markdown) {
			throw new Error(`Firecrawl returned no markdown for ${url}`);
		}

		const title =
			response.metadata?.title?.trim() ||
			response.metadata?.ogTitle?.trim() ||
			new URL(url).hostname;

		return {
			url,
			title,
			markdown,
			excerpt: buildExcerpt(markdown),
			publishedAt:
				response.metadata?.publishedTime ??
				response.metadata?.modifiedTime ??
				response.metadata?.dcDateCreated ??
				null,
			source:
				response.metadata?.ogSiteName ??
				response.metadata?.sourceURL ??
				new URL(url).hostname,
			symbols: extractSymbols(`${title} ${markdown}`),
			mock: false,
		};
	},
});
