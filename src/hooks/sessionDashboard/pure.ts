import type { ResearchNote } from "#/types/research";
import type {
	AgentEvent,
	SessionDashboardHydration,
	SessionSymbolHydration,
} from "#/types/sim";
import type { WatchlistSummaryPayload } from "#/types/watchlist";

export const MAX_AGENT_EVENTS = 200;
export const MAX_RESEARCH_NOTES = 25;
export const MAX_TRADES = 100;

export function buildInitialSummaries(
	watchlist: SessionDashboardHydration["watchlist"],
): Record<string, WatchlistSummaryPayload> {
	const source = watchlist ?? {};
	return Object.fromEntries(
		Object.entries(source).map(([symbol, entry]) => {
			const lastBar = entry.lastBar ?? undefined;
			const snapshot = entry.snapshot ?? undefined;
			const lastPrice = snapshot?.lastPrice ?? (lastBar ? lastBar.close : null);
			return [
				symbol,
				{
					symbol,
					lastPrice,
					high: lastBar?.high ?? null,
					low: lastBar?.low ?? null,
					spread: snapshot?.spread ?? null,
					lastBar,
					snapshot,
					lastTrade: undefined,
					updatedAt: Date.now(),
				},
			];
		}),
	) as Record<string, WatchlistSummaryPayload>;
}

export function mergeResearchFeedNotes(
	previous: ResearchNote[],
	incoming: ResearchNote,
	maxNotes: number,
): ResearchNote[] {
	const deduped = previous.filter((existing) => existing.id !== incoming.id);
	return [incoming, ...deduped].slice(0, maxNotes);
}

export function appendAgentEvent(
	previous: AgentEvent[],
	incoming: AgentEvent,
	maxEvents: number,
): AgentEvent[] {
	if (previous.some((existing) => existing.eventId === incoming.eventId)) {
		return previous;
	}

	const next = [...previous, incoming];
	return next.slice(-maxEvents);
}

export function mergeBar(
	previous: SessionSymbolHydration["bars"],
	bar: SessionSymbolHydration["bars"][number],
): SessionSymbolHydration["bars"] {
	const lastBar = previous[previous.length - 1];
	if (lastBar && lastBar.tick === bar.tick) {
		return [...previous.slice(0, -1), bar];
	}

	return [...previous, bar];
}

export function buildWatchlistSymbolHydration(input: {
	symbol: string;
	watchlist: SessionDashboardHydration["watchlist"];
}): SessionSymbolHydration {
	const entry = input.watchlist[input.symbol];
	return {
		symbol: input.symbol,
		bars: entry?.lastBar ? [entry.lastBar] : [],
		snapshot: entry?.snapshot ?? null,
		trades: [],
	};
}

export function planSymbolDataHydration(input: {
	sessionId: string;
	symbol: string;
	initialSymbolData: SessionSymbolHydration;
	hydratedSymbolKey: string | null;
	watchlist: SessionDashboardHydration["watchlist"];
}): {
	mode: "hydrate" | "fetch";
	nextHydratedSymbolKey: string | null;
	symbolData: SessionSymbolHydration;
} {
	const { sessionId, symbol, initialSymbolData, hydratedSymbolKey, watchlist } =
		input;
	const hydrationKey = `${sessionId}:${initialSymbolData.symbol}`;
	const selectedKey = `${sessionId}:${symbol}`;

	if (hydrationKey === selectedKey && hydratedSymbolKey !== hydrationKey) {
		return {
			mode: "hydrate",
			nextHydratedSymbolKey: hydrationKey,
			symbolData: initialSymbolData,
		};
	}

	return {
		mode: "fetch",
		nextHydratedSymbolKey: hydratedSymbolKey,
		symbolData: buildWatchlistSymbolHydration({
			symbol,
			watchlist,
		}),
	};
}
