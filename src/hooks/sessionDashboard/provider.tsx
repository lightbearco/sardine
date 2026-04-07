import {
	useCallback,
	createContext,
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
	AgentThinkingDelta,
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
import {
	getSessionDashboardFn,
	getSessionSymbolFn,
} from "../useSimulationSessions";
import { useSimWebSocket } from "../useSimWebSocket";
import {
	appendAgentEvent,
	buildWatchlistSymbolHydration,
	buildInitialSummaries,
	mergeBar,
	mergeResearchFeedNotes,
	planSymbolDataHydration,
	MAX_AGENT_EVENTS,
	MAX_RESEARCH_NOTES,
	MAX_TRADES,
} from "./pure";
import { useBufferedChannel } from "./useBufferedChannel";

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

export type SessionDashboardLiveContextValue = {
	isConnected: boolean;
	symbolData: SessionSymbolHydration;
	watchlistSummaries: Record<string, WatchlistSummaryPayload>;
	researchNotes: ResearchNote[];
	agentEvents: AgentEvent[];
	agentThinking: Record<string, string>;
};

export type SessionDashboardProviderValue = SessionDashboardContextValue & {
	researchNotes: SessionDashboardHydration["researchNotes"];
	agentEvents: SessionDashboardHydration["agentEvents"];
	initialSymbolData: SessionSymbolHydration;
};

const SessionDashboardContext =
	createContext<SessionDashboardContextValue | null>(null);
const SessionDashboardLiveContext =
	createContext<SessionDashboardLiveContextValue | null>(null);

function researchReducer(
	previous: ResearchNote[],
	messages: ResearchNote[],
): ResearchNote[] {
	let next = previous;
	for (const note of messages) {
		next = mergeResearchFeedNotes(next, note, MAX_RESEARCH_NOTES);
	}
	return next;
}

function agentReducer(
	previous: AgentEvent[],
	messages: AgentEvent[],
): AgentEvent[] {
	let next = previous;
	for (const event of messages) {
		next = appendAgentEvent(next, event, MAX_AGENT_EVENTS);
	}
	return next;
}

function tradeReducer(
	previous: SessionSymbolHydration["trades"],
	batches: SessionSymbolHydration["trades"][],
): SessionSymbolHydration["trades"] {
	let trades = previous;
	for (const batch of batches) {
		for (const trade of batch) {
			trades = [trade, ...trades].slice(0, MAX_TRADES);
		}
	}
	return trades;
}

function thinkingReducer(
	previous: Record<string, string>,
	deltas: AgentThinkingDelta[],
): Record<string, string> {
	let next = previous;
	for (const delta of deltas) {
		next = { ...next, [delta.agentId]: delta.transcript };
	}
	return next;
}

export function SessionDashboardProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: SessionDashboardProviderValue;
}) {
	const { subscribe, isConnected, reconnectCount } = useSimWebSocket();
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

	useEffect(() => {
		setSessionStatusOverride(null);
	}, [session.status]);

	const effectiveSession = useMemo(
		() =>
			sessionStatusOverride
				? { ...session, status: sessionStatusOverride }
				: session,
		[session, sessionStatusOverride],
	);

	const isPending = effectiveSession.status === "pending";
	const effectiveIsLive =
		isLive &&
		(effectiveSession.status === "active" ||
			effectiveSession.status === "suspended");

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
	const [symbolData, setSymbolData] =
		useState<SessionSymbolHydration>(initialSymbolData);
	const [tradeBaseline, setTradeBaseline] = useState<
		SessionSymbolHydration["trades"]
	>(initialSymbolData.trades);
	const [tradeBaselineVersion, setTradeBaselineVersion] = useState(0);

	const hydratedSymbolKeyRef = useRef<string | null>(null);
	const symbolRequestIdRef = useRef(0);
	const rehydratedRef = useRef<{
		researchNotes: ResearchNote[];
		agentEvents: AgentEvent[];
	} | null>(null);
	const [rehydrationId, setRehydrationId] = useState(0);

	const researchChannel =
		effectiveIsLive && !isPending
			? buildSessionChannel("research", sessionId)
			: null;

	const agentChannel =
		effectiveIsLive && !isPending
			? buildSessionChannel("agents", sessionId)
			: null;

	const thinkingChannel =
		effectiveIsLive && !isPending
			? buildSessionChannel("thinking", sessionId)
			: null;

	const tradeChannel =
		effectiveIsLive && !isPending
			? buildSymbolChannel("trades", sessionId, symbol)
			: null;

	const rehydrated = rehydratedRef.current;
	const researchInitial = rehydrated?.researchNotes ?? initialResearchNotes;
	const agentInitial = rehydrated?.agentEvents ?? initialAgentEvents;
	const dataResetKey = `${reconnectCount}-${rehydrationId}`;
	const tradeResetKey = `${sessionId}:${symbol}:${dataResetKey}:${tradeBaselineVersion}`;

	const hydrateSymbolData = useCallback((next: SessionSymbolHydration) => {
		setSymbolData(next);
		setTradeBaseline(next.trades);
		setTradeBaselineVersion((version) => version + 1);
	}, []);

	const researchNotes = useBufferedChannel<ResearchNote, ResearchNote[]>({
		channel: researchChannel,
		subscribe,
		reducer: researchReducer,
		initialState: researchInitial.slice(0, MAX_RESEARCH_NOTES),
		guard: effectiveIsLive && !isPending,
		resetKey: dataResetKey,
	});

	const agentEvents = useBufferedChannel<AgentEvent, AgentEvent[]>({
		channel: agentChannel,
		subscribe,
		reducer: agentReducer,
		initialState: agentInitial,
		guard: effectiveIsLive && !isPending,
		resetKey: dataResetKey,
	});

	const agentThinking = useBufferedChannel<
		AgentThinkingDelta,
		Record<string, string>
	>({
		channel: thinkingChannel,
		subscribe,
		reducer: thinkingReducer,
		initialState: {} as Record<string, string>,
		guard: effectiveIsLive && !isPending,
		resetKey: reconnectCount,
	});

	const bufferedTrades = useBufferedChannel<
		SessionSymbolHydration["trades"],
		SessionSymbolHydration["trades"]
	>({
		channel: tradeChannel,
		subscribe,
		reducer: tradeReducer,
		initialState: tradeBaseline,
		guard: effectiveIsLive && !isPending,
		resetKey: tradeResetKey,
	});

	useEffect(() => {
		setWatchlistSummaries(buildInitialSummaries(watchlist));
		setSymbolData((prev) => {
			if (prev.symbol === symbol) return prev;
			setTradeBaseline([]);
			setTradeBaselineVersion((version) => version + 1);
			return buildWatchlistSymbolHydration({
				symbol,
				watchlist,
			});
		});
	}, [sessionId, watchlist, symbol]);

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
			hydrateSymbolData(plan.symbolData);

			const requestId = symbolRequestIdRef.current + 1;
			symbolRequestIdRef.current = requestId;
			void getSessionSymbolFn({ data: { sessionId, symbol } })
				.then((next) => {
					if (!next || symbolRequestIdRef.current !== requestId) {
						return;
					}
					hydrateSymbolData(next);
				})
				.catch((error: unknown) => {
					console.error("Failed to fetch symbol data after hydration", error);
				});

			return;
		}

		const requestId = symbolRequestIdRef.current + 1;
		symbolRequestIdRef.current = requestId;
		hydrateSymbolData(plan.symbolData);

		void getSessionSymbolFn({ data: { sessionId, symbol } })
			.then((next) => {
				if (!next || symbolRequestIdRef.current !== requestId) {
					return;
				}
				hydrateSymbolData(next);
			})
			.catch((error: unknown) => {
				console.error("Failed to hydrate symbol data", error);
			});
	}, [hydrateSymbolData, initialSymbolData, sessionId, symbol, watchlist]);

	useEffect(() => {
		if (bufferedTrades.length === 0) return;
		setSymbolData((previous) => ({
			...previous,
			trades: bufferedTrades,
		}));
	}, [bufferedTrades]);

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

		return () => {
			unsubscribeBars();
			unsubscribeOrderBook();
		};
	}, [effectiveIsLive, isPending, sessionId, subscribe, symbol]);

	useEffect(() => {
		if (!isPending) {
			return;
		}

		const unsubscribe = subscribe(
			buildSessionChannel("sim", sessionId),
			(msg: SimChannelMessage) => {
				if (msg.type === "runtime_state") {
					setSessionStatusOverride("active");
					void router.invalidate().catch((error: unknown) => {
						console.error(
							"Failed to invalidate router after runtime_state",
							error,
						);
					});
				}
			},
		);

		return unsubscribe;
	}, [isPending, router, sessionId, subscribe]);

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

	useEffect(() => {
		if (!effectiveIsLive || reconnectCount === 0) {
			return;
		}

		void getSessionDashboardFn({ data: { sessionId } })
			.then((fresh) => {
				if (!fresh) return;
				setWatchlistSummaries(buildInitialSummaries(fresh.watchlist));
				rehydratedRef.current = {
					researchNotes: fresh.researchNotes.slice(0, MAX_RESEARCH_NOTES),
					agentEvents: fresh.agentEvents,
				};
				setRehydrationId((id) => id + 1);
			})
			.catch((err: unknown) => {
				console.error("Failed to re-hydrate after reconnect", err);
			});

		const requestId = symbolRequestIdRef.current + 1;
		symbolRequestIdRef.current = requestId;

		void getSessionSymbolFn({ data: { sessionId, symbol } })
			.then((next) => {
				if (!next || symbolRequestIdRef.current !== requestId) {
					return;
				}
				hydrateSymbolData(next);
			})
			.catch((err: unknown) => {
				console.error("Failed to re-hydrate symbol data after reconnect", err);
			});
	}, [effectiveIsLive, hydrateSymbolData, reconnectCount, sessionId, symbol]);

	const liveValue = useMemo<SessionDashboardLiveContextValue>(
		() => ({
			isConnected,
			symbolData,
			watchlistSummaries,
			researchNotes,
			agentEvents,
			agentThinking,
		}),
		[
			agentEvents,
			agentThinking,
			isConnected,
			researchNotes,
			symbolData,
			watchlistSummaries,
		],
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
