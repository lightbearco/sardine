import type { AgentRegistry } from "#/agents/AgentRegistry";
import type { PublicationBus } from "#/engine/bus/PublicationBus";
import type { ResearchNote } from "#/types/research";

export type ReleasedResearchByAgent = Map<string, ResearchNote[]>;

export function deliverReleasedResearch(
	agentRegistry: AgentRegistry,
	releasedNotes: ReturnType<PublicationBus["releaseDue"]>,
	changedAgentIds: Set<string>,
): ReleasedResearchByAgent {
	const notesByTier = {
		tier1: releasedNotes.tier1,
		tier2: releasedNotes.tier2,
		tier3: releasedNotes.tier3,
	} as const;
	const deliveredByAgent: ReleasedResearchByAgent = new Map();

	for (const entry of agentRegistry.getAll()) {
		if (
			entry.state.tier !== "tier1" &&
			entry.state.tier !== "tier2" &&
			entry.state.tier !== "tier3"
		) {
			continue;
		}

		const tierNotes = notesByTier[entry.state.tier];
		let inboxChanged = false;
		const newlyDelivered: ResearchNote[] = [];

		for (const note of tierNotes) {
			if (entry.state.researchInbox.has(note.id)) {
				continue;
			}

			entry.state.researchInbox.set(note.id, {
				...note,
				releasedToTier: entry.state.tier,
			});
			newlyDelivered.push({
				...note,
				releasedToTier: entry.state.tier,
			});
			inboxChanged = true;
		}

		if (newlyDelivered.length > 0) {
			deliveredByAgent.set(entry.config.id, newlyDelivered);
		}

		if (inboxChanged) {
			changedAgentIds.add(entry.config.id);
		}
	}

	return deliveredByAgent;
}

export function getReleasedNotesForAgent(
	agentRegistry: AgentRegistry,
	agentId: string,
): ResearchNote[] {
	const entry = agentRegistry.get(agentId);
	if (!entry) return [];
	return Array.from(entry.state.researchInbox.values()).sort(
		(left, right) => right.publishedAtTick - left.publishedAtTick,
	);
}
