import { RequestContext } from "@mastra/core/request-context";
import type { Database } from "#/db/index";
import type { EventBus } from "#/engine/bus/EventBus";
import type { PublicationBus } from "#/engine/bus/PublicationBus";
import type { ResearchFocus, ResearchNote } from "#/types/research";

export type ResearchRequestContextValues = {
	"agent-id": string;
	"agent-name": string;
	"research-focus": ResearchFocus;
	"simulation-session-id"?: string;
	sources: string[];
	persona: string;
	"sim-tick"?: number;
	db?: Database;
	"event-bus"?: EventBus;
	"publication-bus"?: PublicationBus;
	"published-research-note-id"?: string;
	"published-research-note"?: ResearchNote;
};

export function cloneResearchRequestContext(
	requestContext: RequestContext<ResearchRequestContextValues>,
): RequestContext<ResearchRequestContextValues> {
	return new RequestContext<ResearchRequestContextValues>(
		Array.from(requestContext.entries()),
	);
}
