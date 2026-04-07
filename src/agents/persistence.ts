import type { InferInsertModel } from "drizzle-orm";
import type { AgentRegistryEntry } from "#/agents/AgentRegistry";
import { agents as agentsTable } from "#/db/schema";
import type { Position } from "#/types/agent";
import Decimal from "decimal.js";

type AgentRecord = InferInsertModel<typeof agentsTable>;

type PersistedPosition = {
	qty: number;
	avgCost: number;
};

function serializePositions(
	positions: Map<string, Position>,
): Record<string, PersistedPosition> {
	return Object.fromEntries(
		Array.from(positions.entries(), ([symbol, position]) => [
			symbol,
			{
				qty: position.qty,
				avgCost: position.avgCost.toNumber(),
			},
		]),
	);
}

function serializeRealizedPnl(
	realizedPnl: Map<string, Decimal>,
): Record<string, number> {
	return Object.fromEntries(
		Array.from(realizedPnl.entries(), ([symbol, pnl]) => [
			symbol,
			pnl.toNumber(),
		]),
	);
}

function serializeModelId(
	model: AgentRegistryEntry["config"]["model"],
): string | null {
	if (typeof model === "string") {
		return model;
	}

	if ("id" in model && typeof model.id === "string") {
		return model.id;
	}

	if (
		"providerId" in model &&
		typeof model.providerId === "string" &&
		"modelId" in model &&
		typeof model.modelId === "string"
	) {
		return `${model.providerId}/${model.modelId}`;
	}

	return null;
}

export function serializeAgentEntryForDb(
	entry: AgentRegistryEntry,
	sessionId: string,
): Pick<
	AgentRecord,
	| "sessionId"
	| "id"
	| "name"
	| "tier"
	| "status"
	| "entityType"
	| "strategyType"
	| "modelId"
	| "persona"
	| "mandateSectors"
	| "riskTolerance"
	| "startingCapital"
	| "currentCash"
	| "currentNav"
	| "positions"
	| "parameters"
	| "realizedPnl"
	| "lastAutopilotDirective"
	| "lastLlmTick"
	| "llmGroup"
> {
	return {
		sessionId,
		id: entry.config.id,
		name: entry.config.name,
		tier: entry.config.tier,
		status: entry.state.status,
		entityType: entry.config.entityType,
		strategyType: entry.config.strategy,
		modelId: serializeModelId(entry.config.model),
		persona: entry.config.persona,
		mandateSectors: [...entry.config.sectors],
		riskTolerance: entry.config.risk,
		startingCapital: entry.config.capital,
		currentCash: entry.state.cash.toNumber(),
		currentNav: entry.state.nav.toNumber(),
		positions: serializePositions(entry.state.positions),
		parameters: { ...entry.config.decisionParams },
		realizedPnl: serializeRealizedPnl(entry.state.realizedPnl),
		lastAutopilotDirective: entry.state.lastAutopilotDirective
			? structuredClone(entry.state.lastAutopilotDirective)
			: null,
		lastLlmTick: entry.state.lastLlmTick,
		llmGroup: entry.state.llmGroup,
	};
}

export function serializeAgentEntriesForDb(
	entries: Iterable<AgentRegistryEntry>,
	sessionId: string,
): ReturnType<typeof serializeAgentEntryForDb>[] {
	return Array.from(entries, (entry) =>
		serializeAgentEntryForDb(entry, sessionId),
	);
}
