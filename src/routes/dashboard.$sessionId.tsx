import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Allotment } from "allotment";
import { useEffect } from "react";
import { z } from "zod";
import { AgentsPanel } from "#/components/dashboard/AgentsPanel";
import { Blotter } from "#/components/dashboard/Blotter";
import { CandlestickChart } from "#/components/dashboard/CandlestickChart";
import { OrderBookPanel } from "#/components/dashboard/OrderBookPanel";
import { ResearchFeed } from "#/components/dashboard/ResearchFeed";
import { TimeAndSales } from "#/components/dashboard/TimeAndSales";
import { TopBar } from "#/components/dashboard/TopBar";
import { Watchlist } from "#/components/dashboard/Watchlist";
import { SessionDashboardProvider } from "#/hooks/useSessionDashboard";
import { getSessionDashboardFn } from "#/hooks/useSimulationSessions";
import type { SessionDashboardHydration } from "#/types/sim";
import {
	isSupportedSessionSymbol,
	shouldReplaceSessionSymbolInUrl,
} from "#/lib/session-symbols";

const dashboardSearchSchema = z.object({
	symbol: z.string().optional(),
});

export const Route = createFileRoute("/dashboard/$sessionId")({
	validateSearch: (search) => dashboardSearchSchema.parse(search),
	loader: async ({ params, location }) => {
		const searchParams = new URLSearchParams(location.search);
		return getSessionDashboardFn({
			data: {
				sessionId: params.sessionId,
				symbol: searchParams.get("symbol") ?? undefined,
			},
		});
	},
	component: DashboardSessionRoute,
});

function DashboardSessionRoute() {
	const data = Route.useLoaderData();
	const hydratedData = data as SessionDashboardHydration | null;
	const params = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/dashboard/$sessionId" });

	useEffect(() => {
		if (!hydratedData) {
			return;
		}

		if (
			!shouldReplaceSessionSymbolInUrl({
				requestedSymbol: search?.symbol,
				resolvedSymbol: hydratedData.symbol,
				supportedSymbols: hydratedData.session.symbols,
			})
		) {
			return;
		}

		void navigate({
			to: "/dashboard/$sessionId",
			params,
			search: { symbol: hydratedData.symbol },
			replace: true,
		});
	}, [hydratedData, navigate, params, search?.symbol]);

	if (!hydratedData) {
		return (
			<main className="mx-auto flex min-h-[calc(100vh-9rem)] w-full max-w-3xl items-center justify-center px-4 py-8">
				<div className="rounded-3xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-6 py-10 text-center text-sm text-[var(--terminal-text-muted)]">
					This simulation session was not found.
				</div>
			</main>
		);
	}

	const requestedSymbol = search?.symbol;
	const selectedSymbol = isSupportedSessionSymbol(
		requestedSymbol,
		hydratedData.session.symbols,
	)
		? requestedSymbol
		: hydratedData.symbol;

	return (
		<SessionDashboardProvider
			value={{
				sessionId: hydratedData.session.id,
				session: hydratedData.session,
				symbol: selectedSymbol,
				setSymbol: (symbol) =>
					void navigate({
						to: "/dashboard/$sessionId",
						params,
						search: (previous) => ({ ...previous, symbol }),
					}),
				isLive: hydratedData.isLive,
				simState: hydratedData.simState,
				watchlist: hydratedData.watchlist,
				bars: hydratedData.bars,
				snapshot: hydratedData.snapshot,
				trades: hydratedData.trades,
				researchNotes: hydratedData.researchNotes,
				agentRoster: hydratedData.agentRoster,
				agentEvents: hydratedData.agentEvents,
			}}
		>
			<main
				className="terminal bg-[var(--terminal-bg)] text-[var(--terminal-text)]"
				style={{ height: "calc(100vh)" }}
			>
				<div className="flex h-full flex-col px-3 pt-3 pb-3 gap-2">
					{/* Top bar */}
					<div className="shrink-0">
						<TopBar />
					</div>

					{/* Resizable body */}
					<div className="min-h-0 flex-1">
						{/* Outer: top row / bottom row */}
						<Allotment vertical defaultSizes={[62, 38]} minSize={120}>
							{/* ── Top row ── */}
							<Allotment.Pane minSize={120}>
								<Allotment defaultSizes={[18, 44, 38]} minSize={140}>
									{/* Watchlist */}
									<Allotment.Pane minSize={140}>
										<div className="h-full px-1">
											<Watchlist />
										</div>
									</Allotment.Pane>

									{/* Chart */}
									<Allotment.Pane minSize={240}>
										<div className="h-full px-1">
											<CandlestickChart />
										</div>
									</Allotment.Pane>

									{/* Order book */}
									<Allotment.Pane minSize={200}>
										<div className="h-full px-1">
											<OrderBookPanel />
										</div>
									</Allotment.Pane>
								</Allotment>
							</Allotment.Pane>
							{/* ── Bottom row ── */}
							<Allotment.Pane minSize={120}>
								<Allotment defaultSizes={[20, 30, 50]} minSize={140}>
									{/* Time & Sales */}
									<Allotment.Pane minSize={140}>
										<div className="h-full px-1">
											<TimeAndSales />
										</div>
									</Allotment.Pane>

									{/* Blotter */}
									<Allotment.Pane minSize={180}>
										<div className="h-full px-1">
											<Blotter />
										</div>
									</Allotment.Pane>

									{/* Agents + Research (nested vertical split) */}
									<Allotment.Pane minSize={200}>
										<Allotment vertical defaultSizes={[70, 30]} minSize={100}>
											<Allotment.Pane minSize={100}>
												<div className="h-full px-1">
													<AgentsPanel />
												</div>
											</Allotment.Pane>
											<Allotment.Pane minSize={100}>
												<div className="h-full px-1">
													<ResearchFeed />
												</div>
											</Allotment.Pane>
										</Allotment>
									</Allotment.Pane>
								</Allotment>
							</Allotment.Pane>
						</Allotment>
					</div>
				</div>
			</main>
		</SessionDashboardProvider>
	);
}
