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
							Realtime market simulation, one dashboard away.
						</h1>
						<p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
							Open the trading terminal to monitor the order book, candles,
							agent decisions, and trade flow in a single full-screen workspace.
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
								Candles, order book, time and sales, and market stats in one
								layout.
							</div>
						</div>
						<div className="rounded-xl border bg-secondary/40 p-4">
							<div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
								Agent View
							</div>
							<div className="mt-2 text-sm text-foreground">
								Track live decisions, signals, failures, and execution flow.
							</div>
						</div>
						<div className="rounded-xl border bg-secondary/40 p-4">
							<div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
								Control View
							</div>
							<div className="mt-2 text-sm text-foreground">
								Manage sim state, tick progression, and playback speed from the
								top bar.
							</div>
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
