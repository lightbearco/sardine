import { createContext, useContext, type ReactNode } from "react";
import type { SessionDashboardHydration, SimulationSessionSummary } from "#/types/sim";

type SessionDashboardContextValue = {
	sessionId: string;
	session: SimulationSessionSummary;
	symbol: string;
	setSymbol: (symbol: string) => void;
	isLive: boolean;
	simState: SessionDashboardHydration["simState"];
	watchlist: SessionDashboardHydration["watchlist"];
	bars: SessionDashboardHydration["bars"];
	snapshot: SessionDashboardHydration["snapshot"];
	trades: SessionDashboardHydration["trades"];
	researchNotes: SessionDashboardHydration["researchNotes"];
	agentRoster: SessionDashboardHydration["agentRoster"];
	agentEvents: SessionDashboardHydration["agentEvents"];
};

const SessionDashboardContext =
	createContext<SessionDashboardContextValue | null>(null);

export function SessionDashboardProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: SessionDashboardContextValue;
}) {
	return (
		<SessionDashboardContext.Provider value={value}>
			{children}
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
