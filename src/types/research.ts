import type { AgentTier } from "./agent";

export type Sentiment = "bullish" | "bearish" | "neutral";

export interface ResearchNote {
	id: string;
	agentId: string;
	focus: string;
	headline: string;
	body: string;
	sentiment: Sentiment;
	confidence: number;
	symbols: string[];
	publishedAtTick: number;
	releasedToTier: AgentTier;
}
