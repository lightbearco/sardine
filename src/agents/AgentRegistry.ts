import { RequestContext } from "@mastra/core/request-context";
import type { AgentConfig, AgentState, Position } from "#/types/agent";
import type { Order } from "#/types/market";
import type { ResearchNote } from "#/types/research";
import { serializeAgentEntriesForDb } from "./persistence";

export interface AgentRegistryEntry {
	config: AgentConfig;
	state: AgentState;
	requestContext: RequestContext<any>;
}

interface SnapshotPosition extends Omit<Position, "avgCost"> {
	avgCost: string;
}

interface SnapshotOrder extends Omit<Order, "price"> {
	price: string;
}

type SnapshotResearchNote = ResearchNote;

export interface AgentRegistrySnapshotEntry {
	config: AgentConfig;
	state: Omit<AgentState, "cash" | "nav" | "positions" | "openOrders" | "researchInbox"> & {
		cash: string;
		nav: string;
		positions: Record<string, SnapshotPosition>;
		openOrders: Record<string, SnapshotOrder>;
		researchInbox: Record<string, SnapshotResearchNote>;
	};
	requestContext: Record<string, unknown>;
}

export class AgentRegistry {
	private readonly entries = new Map<string, AgentRegistryEntry>();

	register(entry: AgentRegistryEntry): void {
		const id = entry.config.id;

		if (entry.state.id !== id) {
			throw new Error(
				`AgentRegistry entry ID mismatch: config.id=${id}, state.id=${entry.state.id}`,
			);
		}

		if (entry.state.llmGroup !== entry.config.llmGroup) {
			throw new Error(
				`AgentRegistry entry group mismatch: config.llmGroup=${entry.config.llmGroup}, state.llmGroup=${entry.state.llmGroup}`,
			);
		}

		if (this.entries.has(id)) {
			throw new Error(`AgentRegistry already contains agent: ${id}`);
		}

		this.entries.set(id, {
			...entry,
			state: this.normalizeState(entry.state),
		});
	}

	get(id: string): AgentRegistryEntry | undefined {
		return this.entries.get(id);
	}

	getAll(): AgentRegistryEntry[] {
		return Array.from(this.entries.values());
	}

	getByGroup(groupNumber: number): AgentRegistryEntry[] {
		return this.getAll().filter(
			(entry) => entry.state.llmGroup === groupNumber,
		);
	}

	getActiveGroup(simTick: number, groupCount: number): AgentRegistryEntry[] {
		if (groupCount <= 0) {
			throw new Error("groupCount must be greater than 0");
		}

		const activeGroup = ((simTick % groupCount) + groupCount) % groupCount;
		return this.getByGroup(activeGroup);
	}

	updateState(id: string, partial: Partial<AgentState>): AgentState {
		const entry = this.entries.get(id);
		if (!entry) {
			throw new Error(`Unknown agent ID: ${id}`);
		}

		const nextState: AgentState = this.normalizeState({
			...entry.state,
			...partial,
			positions: partial.positions ?? entry.state.positions,
			openOrders: partial.openOrders ?? entry.state.openOrders,
		});

		entry.state = nextState;
		return nextState;
	}

	toSnapshot(): Record<string, AgentRegistrySnapshotEntry> {
		return Object.fromEntries(
			Array.from(this.entries.entries()).map(([id, entry]) => [
				id,
				{
					config: this.serializeConfig(entry.config),
					state: {
						...this.serializeState(entry.state),
						positions: this.serializePositions(entry.state.positions),
						openOrders: this.serializeOpenOrders(entry.state.openOrders),
						researchInbox: this.serializeResearchInbox(entry.state.researchInbox),
					},
					requestContext: entry.requestContext.toJSON() as Record<
						string,
						unknown
					>,
				},
			]),
		);
	}

	clear(): void {
		this.entries.clear();
	}

	toPersistenceRows(sessionId: string) {
		return serializeAgentEntriesForDb(this.getAll(), sessionId);
	}

	private serializeConfig(config: AgentConfig): AgentConfig {
		return {
			...config,
			personalityTraits: [...config.personalityTraits],
			behavioralBiases: [...config.behavioralBiases],
			constraints: [...config.constraints],
			restrictedSymbols: [...config.restrictedSymbols],
			sectors: [...config.sectors],
			decisionParams: { ...config.decisionParams },
		};
	}

	private serializeState(
		state: AgentState,
	): Omit<
		AgentRegistrySnapshotEntry["state"],
		"positions" | "openOrders" | "researchInbox"
	> {
		return {
			...state,
			cash: state.cash.toString(),
			nav: state.nav.toString(),
			lastAutopilotDirective: state.lastAutopilotDirective
				? structuredClone(state.lastAutopilotDirective)
				: null,
		};
	}

	private serializePositions(
		positions: Map<string, Position>,
	): Record<string, SnapshotPosition> {
		return Object.fromEntries(
			Array.from(positions.entries(), ([symbol, position]) => [
				symbol,
				{
					qty: position.qty,
					avgCost: position.avgCost.toString(),
				},
			]),
		);
	}

	private serializeOpenOrders(
		openOrders: Map<string, Order>,
	): Record<string, SnapshotOrder> {
		return Object.fromEntries(
			Array.from(openOrders.entries(), ([orderId, order]) => [
				orderId,
				{
					...order,
					price: order.price.toString(),
				},
			]),
		);
	}

	private serializeResearchInbox(
		researchInbox: Map<string, ResearchNote>,
	): Record<string, SnapshotResearchNote> {
		return Object.fromEntries(
			Array.from(researchInbox.entries(), ([noteId, note]) => [
				noteId,
				structuredClone(note),
			]),
		);
	}

	private normalizeState(state: AgentState): AgentState {
		return {
			...state,
			openOrders: this.pruneOpenOrders(state.openOrders),
		};
	}

	private pruneOpenOrders(openOrders: Map<string, Order>): Map<string, Order> {
		return new Map(
			Array.from(openOrders.entries()).filter(([, order]) =>
				order.status === "pending" ||
				order.status === "open" ||
				order.status === "partial",
			),
		);
	}
}
