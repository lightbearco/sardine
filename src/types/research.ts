import type { AgentTier } from "./agent";

export type Sentiment = "bullish" | "bearish" | "neutral";
export type ResearchFocus = "news" | "sentiment" | "macro" | "filings";

export interface ResearchNote {
	id: string;
	agentId: string;
	focus: ResearchFocus;
	headline: string;
	body: string;
	sentiment: Sentiment;
	confidence: number;
	symbols: string[];
	sources: string[];
	publishedAtTick: number;
	releasedToTier: AgentTier;
}
