import { db } from "#/db/index";
import { EventBus } from "#/engine/bus/EventBus";
import { PublicationBus } from "#/engine/bus/PublicationBus";
import { createLogger } from "#/lib/logger";
import {
	researchAgent,
	researchCycleResultSchema,
} from "#/mastra/agents/research-agent";
import { cloneResearchRequestContext } from "#/mastra/research-context";
import type { ResearchAgentWorker } from "#/agents/bootstrap";

const log = createLogger("SimRunner");

export type ResearchAgentLike = {
	generate(
		prompt: string,
		options: Record<string, unknown>,
	): Promise<{
		object: unknown;
	}>;
};

export function shouldRunResearchCycle(
	simTick: number,
	frequency: number = 20,
): boolean {
	return simTick === 1 || (simTick > 0 && simTick % frequency === 0);
}

function buildResearchPrompt(
	worker: ResearchAgentWorker,
	simTick: number,
): string {
	return [
		`Simulation tick: ${simTick}`,
		`You are covering the ${worker.focus} desk this cycle.`,
		"Review your assigned sources, scrape the most relevant one or two URLs, and publish at most one actionable research note.",
		"If nothing is actionable, explain why and do not publish a note.",
	].join("\n\n");
}

export async function runResearchCycle(
	workers: ResearchAgentWorker[],
	simTick: number,
	publicationBus: PublicationBus,
	eventBus: EventBus,
	sessionId: string,
	agent: ResearchAgentLike = researchAgent,
	frequency: number = 20,
): Promise<void> {
	if (!shouldRunResearchCycle(simTick, frequency) || workers.length === 0) {
		return;
	}

	const outcomes = await Promise.allSettled(
		workers.map(async (worker) => {
			const requestContext = cloneResearchRequestContext(worker.requestContext);
			requestContext.set("sim-tick", simTick);
			requestContext.set("simulation-session-id", sessionId);
			requestContext.set("publication-bus", publicationBus);
			requestContext.set("event-bus", eventBus);
			requestContext.set("db", db);
			requestContext.set("published-research-note-id", undefined);
			requestContext.set("published-research-note", undefined);

			const result = await agent.generate(buildResearchPrompt(worker, simTick), {
				resourceId: sessionId,
				requestContext,
				maxSteps: 6,
				structuredOutput: {
					schema: researchCycleResultSchema,
				},
			});

			return researchCycleResultSchema.parse(result.object);
		}),
	);

	for (const [index, outcome] of outcomes.entries()) {
		if (outcome.status === "fulfilled") {
			continue;
		}

		log.error(
			{
				err: outcome.reason,
				workerId: workers[index]?.id ?? "unknown",
				simTick,
			},
			"research cycle failed",
		);
	}
}
