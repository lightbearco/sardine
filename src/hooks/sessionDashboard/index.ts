export {
	appendAgentEvent,
	buildInitialSummaries,
	mergeBar,
	mergeResearchFeedNotes,
	planSymbolDataHydration,
	MAX_AGENT_EVENTS,
	MAX_RESEARCH_NOTES,
	MAX_TRADES,
} from "./pure";

export {
	SessionDashboardProvider,
	useSessionDashboard,
	useSessionDashboardLiveState,
	type SessionDashboardContextValue,
	type SessionDashboardLiveContextValue,
	type SessionDashboardProviderValue,
} from "./provider";
