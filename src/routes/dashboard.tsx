import { createFileRoute } from "@tanstack/react-router";
import { AgentsPanel } from "#/components/dashboard/AgentsPanel";
import { Blotter } from "#/components/dashboard/Blotter";
import { CandlestickChart } from "#/components/dashboard/CandlestickChart";
import { OrderBookPanel } from "#/components/dashboard/OrderBookPanel";
import { TimeAndSales } from "#/components/dashboard/TimeAndSales";
import { TopBar } from "#/components/dashboard/TopBar";
import { Watchlist } from "#/components/dashboard/Watchlist";
import { SymbolSelectionProvider } from "#/hooks/useSymbolSelection";

export const Route = createFileRoute("/dashboard")({
	component: DashboardRoute,
});

function DashboardRoute() {
	return (
		<SymbolSelectionProvider>
			<main className="terminal fixed inset-0 z-50 bg-[var(--terminal-bg)] px-4 py-4 text-[var(--terminal-text)]">
				<div
					className="grid h-full gap-4"
					style={{
						gridTemplateColumns: "220px 1fr 1fr 300px",
						gridTemplateRows: "auto 3fr 2fr",
						gridTemplateAreas: `
              "topbar topbar topbar topbar"
              "watch chart chart book"
              "tape blotter signals signals"
            `,
					}}
				>
					<div style={{ gridArea: "topbar" }}>
						<TopBar />
					</div>
					<div style={{ gridArea: "watch" }} className="min-h-0">
						<Watchlist />
					</div>
					<div style={{ gridArea: "chart" }} className="min-h-0">
						<CandlestickChart />
					</div>
					<div style={{ gridArea: "book" }} className="min-h-0">
						<OrderBookPanel />
					</div>
					<div style={{ gridArea: "tape" }} className="min-h-0">
						<TimeAndSales />
					</div>
					<div style={{ gridArea: "blotter" }} className="min-h-0">
						<Blotter />
					</div>
					<div style={{ gridArea: "signals" }} className="min-h-0">
						<AgentsPanel />
					</div>
				</div>
			</main>
		</SymbolSelectionProvider>
	);
}
