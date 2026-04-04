import type { AgentState } from "#/types/agent";
import type { AgentRegistry, AgentRegistryEntry } from "./AgentRegistry";

export function getActiveGroupIndex(
	simTick: number,
	groupCount: number,
): number {
	if (groupCount <= 0) {
		throw new Error("groupCount must be greater than 0");
	}

	return ((simTick % groupCount) + groupCount) % groupCount;
}

export function partitionAgents(
	registry: AgentRegistry,
	simTick: number,
	groupCount: number,
): {
	active: AgentState[];
	inactive: AgentState[];
} {
	const activeGroupIndex = getActiveGroupIndex(simTick, groupCount);
	const active: AgentState[] = [];
	const inactive: AgentState[] = [];

	for (const entry of registry.getAll()) {
		if (entry.state.status !== "active") {
			continue;
		}

		if (entry.state.llmGroup === activeGroupIndex) {
			active.push(entry.state);
			continue;
		}

		inactive.push(entry.state);
	}

	return { active, inactive };
}

export function partitionAgentEntries(
	registry: AgentRegistry,
	simTick: number,
	groupCount: number,
): {
	active: AgentRegistryEntry[];
	inactive: AgentRegistryEntry[];
} {
	const activeGroupIndex = getActiveGroupIndex(simTick, groupCount);
	const active: AgentRegistryEntry[] = [];
	const inactive: AgentRegistryEntry[] = [];

	for (const entry of registry.getAll()) {
		if (entry.state.status !== "active") {
			continue;
		}

		if (entry.state.llmGroup === activeGroupIndex) {
			active.push(entry);
			continue;
		}

		inactive.push(entry);
	}

	return { active, inactive };
}
