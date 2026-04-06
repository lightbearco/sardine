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
import {
	MaximizedPanelProvider,
	useMaximizedPanel,
} from "#/hooks/useMaximizedPanel";
import { SessionDashboardProvider } from "#/hooks/useSessionDashboard";
import {
	getSessionDashboardFn,
	getSessionSymbolFn,
} from "#/hooks/useSimulationSessions";
import type {
	SessionDashboardHydration,
	SessionSymbolHydration,
} from "#/types/sim";
import {
	normalizeSessionSymbol,
	shouldReplaceSessionSymbolInUrl,
} from "#/lib/session-symbols";

const dashboardSearchSchema = z.object({
	symbol: z.string().optional(),
});

export const dashboardLoaderDeps = () => ({});

export const Route = createFileRoute("/dashboard/$sessionId")({
	validateSearch: (search) => dashboardSearchSchema.parse(search),
	loaderDeps: dashboardLoaderDeps,
	loader: async ({ params, location }) => {
		const dashboard = await getSessionDashboardFn({
			data: { sessionId: params.sessionId },
		});

		if (!dashboard) {
			return { dashboard: null, symbolData: null };
		}

		const searchParams = new URLSearchParams(location.search);
		const symbol = normalizeSessionSymbol(
			searchParams.get("symbol") ?? undefined,
			dashboard.session.symbols,
		);
		const symbolData = await getSessionSymbolFn({
			data: {
				sessionId: params.sessionId,
				symbol,
			},
		});

		return { dashboard, symbolData };
	},
	component: DashboardSessionRoute,
});

function DashboardSessionRoute() {
	const data = Route.useLoaderData();
	const hydratedData = data.dashboard as SessionDashboardHydration | null;
	const initialSymbolData = data.symbolData as SessionSymbolHydration | null;
	const params = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/dashboard/$sessionId" });
	const resolvedSymbol = hydratedData
		? normalizeSessionSymbol(search?.symbol, hydratedData.session.symbols)
		: undefined;

	useEffect(() => {
		if (!hydratedData || !resolvedSymbol) {
			return;
		}

		if (
			!shouldReplaceSessionSymbolInUrl({
				requestedSymbol: search?.symbol,
				resolvedSymbol,
				supportedSymbols: hydratedData.session.symbols,
			})
		) {
			return;
		}

		void navigate({
			to: "/dashboard/$sessionId",
			params,
			search: { symbol: resolvedSymbol },
			replace: true,
		});
	}, [hydratedData, navigate, params, resolvedSymbol, search?.symbol]);

	if (!hydratedData || !initialSymbolData || !resolvedSymbol) {
		return (
			<main className="mx-auto flex min-h-[calc(100vh-9rem)] w-full max-w-3xl items-center justify-center px-4 py-8">
				<div className="rounded-3xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-6 py-10 text-center text-sm text-[var(--terminal-text-muted)]">
					This simulation session was not found.
				</div>
			</main>
		);
	}

	const isPending = hydratedData.session.status === "pending";

	const providerValue = {
		sessionId: hydratedData.session.id,
		session: hydratedData.session,
		symbol: resolvedSymbol,
		setSymbol: (symbol: string) =>
			void navigate({
				to: "/dashboard/$sessionId",
				params,
				search: (previous) => ({ ...previous, symbol }),
			}),
		isLive: hydratedData.isLive,
		simState: hydratedData.simState,
		watchlist: hydratedData.watchlist,
		researchNotes: hydratedData.researchNotes,
		agentRoster: hydratedData.agentRoster,
		agentEvents: hydratedData.agentEvents,
		initialSymbolData,
	};

	if (isPending) {
		return (
			<SessionDashboardProvider value={providerValue}>
				<main
					className="terminal bg-[var(--terminal-bg)] text-[var(--terminal-text)]"
					style={{ height: "calc(100vh)" }}
				>
					<div className="flex h-full flex-col px-3 pt-3 pb-3 gap-2">
						<div className="shrink-0">
							<TopBar />
						</div>
						<div className="flex min-h-0 flex-1 items-center justify-center">
							<div className="rounded-2xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-8 py-10 text-center max-w-md">
								<div className="mb-4 text-lg font-semibold text-[var(--terminal-text)]">
									{hydratedData.session.name}
								</div>
								<div className="mb-2 text-sm text-[var(--terminal-text-muted)]">
									Queued for simulation runner...
								</div>
								<div className="mt-6 space-y-1 text-xs text-[var(--terminal-text-muted)]">
									<div>
										{hydratedData.session.agentCount} agent
										{hydratedData.session.agentCount !== 1 && "s"}
									</div>
									<div>
										{hydratedData.session.symbols.length} symbol
										{hydratedData.session.symbols.length !== 1 && "s"}:{" "}
										{hydratedData.session.symbols.join(", ")}
									</div>
								</div>
							</div>
						</div>
					</div>
				</main>
			</SessionDashboardProvider>
		);
	}

	return (
		<SessionDashboardProvider value={providerValue}>
			<MaximizedPanelProvider>
				<DashboardBody />
			</MaximizedPanelProvider>
		</SessionDashboardProvider>
	);
}

function panelStyle(panelId: string, maximizedId: string | null) {
	if (maximizedId !== panelId) return undefined;
	return {
		position: "fixed" as const,
		inset: 0,
		zIndex: 50,
		padding: 4,
		background: "var(--terminal-bg)",
	};
}

function DashboardBody() {
	const { maximizedId } = useMaximizedPanel();

	return (
		<main
			className="terminal bg-[var(--terminal-bg)] text-[var(--terminal-text)]"
			style={{ height: "calc(100vh)" }}
		>
			<div className="flex h-full flex-col px-3 pt-3 pb-3 gap-2">
				<div className="shrink-0">
					<TopBar />
				</div>

				<div className="min-h-0 flex-1">
					<Allotment vertical defaultSizes={[62, 38]} minSize={120}>
						<Allotment.Pane minSize={120}>
							<Allotment defaultSizes={[18, 44, 38]} minSize={140}>
								<Allotment.Pane minSize={140}>
									<div
										className="h-full px-1"
										style={panelStyle("watchlist", maximizedId)}
									>
										<Watchlist />
									</div>
								</Allotment.Pane>

								<Allotment.Pane minSize={240}>
									<div
										className="h-full px-1"
										style={panelStyle("chart", maximizedId)}
									>
										<CandlestickChart />
									</div>
								</Allotment.Pane>

								<Allotment.Pane minSize={200}>
									<div
										className="h-full px-1"
										style={panelStyle("orderbook", maximizedId)}
									>
										<OrderBookPanel />
									</div>
								</Allotment.Pane>
							</Allotment>
						</Allotment.Pane>

						<Allotment.Pane minSize={120}>
							<Allotment defaultSizes={[20, 30, 50]} minSize={140}>
								<Allotment.Pane minSize={140}>
									<div
										className="h-full px-1"
										style={panelStyle("timeAndSales", maximizedId)}
									>
										<TimeAndSales />
									</div>
								</Allotment.Pane>

								<Allotment.Pane minSize={180}>
									<div
										className="h-full px-1"
										style={panelStyle("blotter", maximizedId)}
									>
										<Blotter />
									</div>
								</Allotment.Pane>

								<Allotment.Pane minSize={200}>
									<Allotment vertical defaultSizes={[70, 30]} minSize={100}>
										<Allotment.Pane minSize={100}>
											<div
												className="h-full px-1"
												style={panelStyle("agents", maximizedId)}
											>
												<AgentsPanel />
											</div>
										</Allotment.Pane>
										<Allotment.Pane minSize={100}>
											<div
												className="h-full px-1"
												style={panelStyle("research", maximizedId)}
											>
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
	);
}
