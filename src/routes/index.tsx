import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, LayoutDashboardIcon } from "lucide-react";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/")({
	component: LandingPage,
});

function LandingPage() {
	return (
		<main className="page-wrap pb-16 pt-12">
			<section>
				<div className="max-w-3xl space-y-5">
					<div className="space-y-3">
						<h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
							World's most advanced market simulation.
						</h1>
						<p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
							Our platform simulates financial markets using over 1,000
							AI-driven agents, each with its own unique personality, strategy,
							and decision-making model. Currently, we cover 500 S&P 500
							tickers—with the flexibility to expand even further. These agents
							are designed to reflect real-world behavior, emulating the trading
							styles of major institutions like Goldman Sachs, BlackRock, and
							JPMorgan.
						</p>
					</div>
					<div className="flex flex-wrap gap-3">
						<Button asChild size="lg">
							<Link to="/dashboard">
								<LayoutDashboardIcon className="size-4 text-primary-foreground" />
								<span className="text-primary-foreground">Open Dashboard</span>
								<ArrowRightIcon className="size-4 text-primary-foreground" />
							</Link>
						</Button>
					</div>
					<div className="grid gap-3 pt-4 sm:grid-cols-3">
						<div className="rounded-xl border bg-secondary/40 p-4">
							<div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
								Market View
							</div>
							<div className="mt-2 text-sm text-foreground">
								Unified view of price action, order book depth, time & sales,
								and key market metrics.
							</div>
						</div>

						<div className="rounded-xl border bg-secondary/40 p-4">
							<div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
								Agent View
							</div>
							<div className="mt-2 text-sm text-foreground">
								Monitor agent behavior in real time—signals, decisions,
								execution paths, and failures.
							</div>
						</div>

						<div className="rounded-xl border bg-secondary/40 p-4">
							<div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
								Control View
							</div>
							<div className="mt-2 text-sm text-foreground">
								Control the simulation with precision—adjust state, tick speed,
								and playback seamlessly.
							</div>
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
