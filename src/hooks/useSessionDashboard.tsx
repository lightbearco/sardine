import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useRouter } from "@tanstack/react-router";
import type { ResearchNote } from "#/types/research";
import type {
	AgentEvent,
	SessionDashboardHydration,
	SessionSymbolHydration,
	SimulationSessionStatus,
	SimulationSessionSummary,
} from "#/types/sim";
import {
	buildSessionChannel,
	buildSymbolChannel,
	type SimChannelMessage,
} from "#/types/ws";
import type { WatchlistSummaryPayload } from "#/types/watchlist";
import { getSessionSymbolFn } from "./useSimulationSessions";
import { useSimWebSocket } from "./useSimWebSocket";

const MAX_AGENT_EVENTS = 200;
const MAX_RESEARCH_NOTES = 25;

const raf =
	typeof requestAnimationFrame !== "undefined"
		? requestAnimationFrame
		: (cb: FrameRequestCallback) => setTimeout(cb, 16);
const caf =
	typeof cancelAnimationFrame !== "undefined"
		? cancelAnimationFrame
		: (handle: number) => clearTimeout(handle);

export type SessionDashboardContextValue = {
	sessionId: string;
	session: SimulationSessionSummary;
	symbol: string;
	setSymbol: (symbol: string) => void;
	isLive: boolean;
	simState: SessionDashboardHydration["simState"];
	watchlist: SessionDashboardHydration["watchlist"];
	agentRoster: SessionDashboardHydration["agentRoster"];
};

type SessionDashboardLiveContextValue = {
	isConnected: boolean;
	symbolData: SessionSymbolHydration;
	watchlistSummaries: Record<string, WatchlistSummaryPayload>;
	researchNotes: ResearchNote[];
	agentEvents: AgentEvent[];
};

type SessionDashboardProviderValue = SessionDashboardContextValue & {
	researchNotes: SessionDashboardHydration["researchNotes"];
	agentEvents: SessionDashboardHydration["agentEvents"];
	initialSymbolData: SessionSymbolHydration;
};

const SessionDashboardContext =
	createContext<SessionDashboardContextValue | null>(null);
const SessionDashboardLiveContext =
	createContext<SessionDashboardLiveContextValue | null>(null);

function buildInitialSummaries(
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
					divergencePct: entry.divergencePct ?? null,
					lastBar,
					snapshot,
					lastTrade: undefined,
					updatedAt: Date.now(),
				},
			];
		}),
	) as Record<string, WatchlistSummaryPayload>;
}

function mergeResearchFeedNotes(
	previous: ResearchNote[],
	incoming: ResearchNote,
	maxNotes: number,
): ResearchNote[] {
	const deduped = previous.filter((existing) => existing.id !== incoming.id);
	return [incoming, ...deduped].slice(0, maxNotes);
}

function appendAgentEvent(
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

function mergeBar(
	previous: SessionSymbolHydration["bars"],
	bar: SessionSymbolHydration["bars"][number],
): SessionSymbolHydration["bars"] {
	const lastBar = previous[previous.length - 1];
	if (lastBar && lastBar.tick === bar.tick) {
		return [...previous.slice(0, -1), bar];
	}

	return [...previous, bar];
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
		symbolData: {
			symbol,
			bars: watchlist[symbol]?.lastBar ? [watchlist[symbol].lastBar] : [],
			snapshot: watchlist[symbol]?.snapshot ?? null,
			trades: [],
		},
	};
}

export function SessionDashboardProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: SessionDashboardProviderValue;
}) {
	const { subscribe, isConnected } = useSimWebSocket();
	const router = useRouter();
	const {
		sessionId,
		session,
		symbol,
		setSymbol,
		isLive,
		simState,
		watchlist,
		researchNotes: initialResearchNotes,
		agentRoster,
		agentEvents: initialAgentEvents,
		initialSymbolData,
	} = value;

	const [sessionStatusOverride, setSessionStatusOverride] =
		useState<SimulationSessionStatus | null>(null);

	const effectiveSession = useMemo(
		() =>
			sessionStatusOverride
				? { ...session, status: sessionStatusOverride }
				: session,
		[session, sessionStatusOverride],
	);

	const isPending = effectiveSession.status === "pending";
	const effectiveIsLive = isLive && effectiveSession.status === "active";

	const baseValue = useMemo<SessionDashboardContextValue>(
		() => ({
			sessionId,
			session: effectiveSession,
			symbol,
			setSymbol,
			isLive: effectiveIsLive,
			simState,
			watchlist,
			agentRoster,
		}),
		[
			agentRoster,
			effectiveIsLive,
			effectiveSession,
			sessionId,
			setSymbol,
			simState,
			symbol,
			watchlist,
		],
	);

	const [watchlistSummaries, setWatchlistSummaries] = useState(() =>
		buildInitialSummaries(watchlist),
	);
	const [researchNotes, setResearchNotes] = useState<ResearchNote[]>(
		initialResearchNotes.slice(0, MAX_RESEARCH_NOTES),
	);
	const [agentEvents, setAgentEvents] =
		useState<AgentEvent[]>(initialAgentEvents);
	const [symbolData, setSymbolData] =
		useState<SessionSymbolHydration>(initialSymbolData);

	const researchQueueRef = useRef<ResearchNote[]>([]);
	const researchFrameRef = useRef<number | null>(null);
	const agentQueueRef = useRef<AgentEvent[]>([]);
	const agentFrameRef = useRef<number | null>(null);
	const tradeQueueRef = useRef<SessionSymbolHydration["trades"]>([]);
	const tradeFrameRef = useRef<number | null>(null);
	const hydratedSymbolKeyRef = useRef<string | null>(null);
	const symbolRequestIdRef = useRef(0);

	const flushResearchQueue = useCallback(() => {
		researchFrameRef.current = null;
		const incoming = researchQueueRef.current.splice(0);
		if (incoming.length === 0) {
			return;
		}

		setResearchNotes((previous) => {
			let next = previous;
			for (const note of incoming) {
				next = mergeResearchFeedNotes(next, note, MAX_RESEARCH_NOTES);
			}
			return next;
		});

		if (researchQueueRef.current.length > 0) {
			researchFrameRef.current = raf(flushResearchQueue);
		}
	}, []);

	const flushAgentQueue = useCallback(() => {
		agentFrameRef.current = null;
		const incoming = agentQueueRef.current.splice(0);
		if (incoming.length === 0) {
			return;
		}

		setAgentEvents((previous) => {
			let next = previous;
			for (const event of incoming) {
				next = appendAgentEvent(next, event, MAX_AGENT_EVENTS);
			}
			return next;
		});

		if (agentQueueRef.current.length > 0) {
			agentFrameRef.current = raf(flushAgentQueue);
		}
	}, []);

	const flushTradeQueue = useCallback(() => {
		tradeFrameRef.current = null;
		const incoming = tradeQueueRef.current.splice(0);
		if (incoming.length === 0) {
			return;
		}

		setSymbolData((previous) => {
			let trades = previous.trades;
			for (const trade of incoming) {
				trades = [trade, ...trades].slice(0, 100);
			}
			return {
				...previous,
				trades,
			};
		});

		if (tradeQueueRef.current.length > 0) {
			tradeFrameRef.current = raf(flushTradeQueue);
		}
	}, []);

	useEffect(() => {
		setWatchlistSummaries(buildInitialSummaries(watchlist));
	}, [sessionId, watchlist]);

	useEffect(() => {
		setResearchNotes(initialResearchNotes.slice(0, MAX_RESEARCH_NOTES));
	}, [initialResearchNotes, sessionId]);

	useEffect(() => {
		setAgentEvents(initialAgentEvents);
	}, [initialAgentEvents, sessionId]);

	useEffect(() => {
		const plan = planSymbolDataHydration({
			sessionId,
			symbol,
			initialSymbolData,
			hydratedSymbolKey: hydratedSymbolKeyRef.current,
			watchlist,
		});

		if (plan.mode === "hydrate") {
			hydratedSymbolKeyRef.current = plan.nextHydratedSymbolKey;
			setSymbolData(plan.symbolData);
			return;
		}

		const requestId = symbolRequestIdRef.current + 1;
		symbolRequestIdRef.current = requestId;
		setSymbolData(plan.symbolData);

		void getSessionSymbolFn({ data: { sessionId, symbol } })
			.then((next) => {
				if (!next || symbolRequestIdRef.current !== requestId) {
					return;
				}
				setSymbolData(next);
			})
			.catch((error: unknown) => {
				console.error("Failed to hydrate symbol data", error);
			});
	}, [initialSymbolData, sessionId, symbol, watchlist]);

	useEffect(() => {
		if (!effectiveIsLive || isPending) {
			return;
		}

		const unsubscribe = subscribe(
			buildSessionChannel("watchlist", sessionId),
			(payload: WatchlistSummaryPayload) => {
				setWatchlistSummaries((previous) => ({
					...previous,
					[payload.symbol]: payload,
				}));
			},
		);

		return unsubscribe;
	}, [effectiveIsLive, isPending, sessionId, subscribe]);

	useEffect(() => {
		if (!effectiveIsLive || isPending) {
			return;
		}

		const unsubscribe = subscribe(
			buildSessionChannel("research", sessionId),
			(note: ResearchNote) => {
				researchQueueRef.current.push(note);
				if (researchFrameRef.current === null) {
					researchFrameRef.current = raf(flushResearchQueue);
				}
			},
		);

		return () => {
			unsubscribe();
			if (researchFrameRef.current !== null) {
				caf(researchFrameRef.current);
				researchFrameRef.current = null;
			}
			researchQueueRef.current.splice(0);
		};
	}, [effectiveIsLive, flushResearchQueue, isPending, sessionId, subscribe]);

	useEffect(() => {
		if (!effectiveIsLive || isPending) {
			return;
		}

		const unsubscribe = subscribe(
			buildSessionChannel("agents", sessionId),
			(event: AgentEvent) => {
				agentQueueRef.current.push(event);
				if (agentFrameRef.current === null) {
					agentFrameRef.current = raf(flushAgentQueue);
				}
			},
		);

		return () => {
			unsubscribe();
			if (agentFrameRef.current !== null) {
				caf(agentFrameRef.current);
				agentFrameRef.current = null;
			}
			agentQueueRef.current.splice(0);
		};
	}, [effectiveIsLive, flushAgentQueue, isPending, sessionId, subscribe]);

	useEffect(() => {
		if (!effectiveIsLive || isPending) {
			return;
		}

		const unsubscribeBars = subscribe(
			buildSymbolChannel("ohlcv", sessionId, symbol),
			(nextBar: SessionSymbolHydration["bars"][number]) => {
				setSymbolData((previous) => ({
					...previous,
					symbol,
					bars: mergeBar(previous.bars, nextBar),
				}));
			},
		);

		const unsubscribeOrderBook = subscribe(
			buildSymbolChannel("lob", sessionId, symbol),
			(nextSnapshot: SessionSymbolHydration["snapshot"]) => {
				setSymbolData((previous) => ({
					...previous,
					symbol,
					snapshot: nextSnapshot,
				}));
			},
		);

		const unsubscribeTrades = subscribe(
			buildSymbolChannel("trades", sessionId, symbol),
			(nextTrades: SessionSymbolHydration["trades"]) => {
				tradeQueueRef.current.push(...nextTrades);
				if (tradeFrameRef.current === null) {
					tradeFrameRef.current = raf(flushTradeQueue);
				}
			},
		);

		return () => {
			unsubscribeBars();
			unsubscribeOrderBook();
			unsubscribeTrades();
			if (tradeFrameRef.current !== null) {
				caf(tradeFrameRef.current);
				tradeFrameRef.current = null;
			}
			tradeQueueRef.current.splice(0);
		};
	}, [
		effectiveIsLive,
		flushTradeQueue,
		isPending,
		sessionId,
		subscribe,
		symbol,
	]);

	useEffect(() => {
		if (!isPending) {
			return;
		}

		const unsubscribe = subscribe(
			buildSessionChannel("sim", sessionId),
			(msg: SimChannelMessage) => {
				if (msg.type === "runtime_state") {
					setSessionStatusOverride("active");
					void router.invalidate();
				}
			},
		);

		return unsubscribe;
	}, [isPending, sessionId, subscribe]);

	useEffect(() => {
		if (!effectiveIsLive || isPending) {
			return;
		}

		const unsubscribe = subscribe(
			buildSessionChannel("sim", sessionId),
			(msg: SimChannelMessage) => {
				if (msg.type === "session_status_changed") {
					setSessionStatusOverride(msg.payload.status);
				}
			},
		);

		return unsubscribe;
	}, [effectiveIsLive, isPending, sessionId, subscribe]);

	const liveValue = useMemo<SessionDashboardLiveContextValue>(
		() => ({
			isConnected,
			symbolData,
			watchlistSummaries,
			researchNotes,
			agentEvents,
		}),
		[agentEvents, isConnected, researchNotes, symbolData, watchlistSummaries],
	);

	return (
		<SessionDashboardContext.Provider value={baseValue}>
			<SessionDashboardLiveContext.Provider value={liveValue}>
				{children}
			</SessionDashboardLiveContext.Provider>
		</SessionDashboardContext.Provider>
	);
}

export function useSessionDashboard() {
	const context = useContext(SessionDashboardContext);

	if (!context) {
		throw new Error(
			"useSessionDashboard must be used within a SessionDashboardProvider",
		);
	}

	return context;
}

export function useSessionDashboardLiveState() {
	const context = useContext(SessionDashboardLiveContext);

	if (!context) {
		throw new Error(
			"useSessionDashboardLiveState must be used within a SessionDashboardProvider",
		);
	}

	return context;
}
