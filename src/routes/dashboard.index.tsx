import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "#/components/ui/button";
import {
	createSimulationSessionFn,
	listSimulationSessionsFn,
} from "#/hooks/useSimulationSessions";
import {
	buildDefaultTraderDistribution,
	buildDefaultSimulationSessionInput,
	deriveGroupCount,
	sumTraderDistribution,
	TRADER_DISTRIBUTION_KEYS,
	TRADER_DISTRIBUTION_LABELS,
	type CreateSimulationSessionInput,
	type TraderDistributionKey,
} from "#/lib/simulation-session";

export const Route = createFileRoute("/dashboard/")({
	loader: async () => listSimulationSessionsFn(),
	component: DashboardSessionsRoute,
});

function DashboardSessionsRoute() {
	const sessions = Route.useLoaderData();
	const navigate = useNavigate({ from: "/dashboard/" });
	const [isConfigOpen, setIsConfigOpen] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [form, setForm] = useState<CreateSimulationSessionInput>(
		buildDefaultSimulationSessionInput(),
	);
	const derivedGroupCount = deriveGroupCount(form.agentCount, form.activeGroupSize);
	const distributionTotal = sumTraderDistribution(form.traderDistribution);
	const distributionMismatch = distributionTotal !== form.agentCount;

	function updateNumberField<Key extends Exclude<keyof CreateSimulationSessionInput, "traderDistribution">>(
		key: Key,
		value: number,
	) {
		setForm((current) => {
			const next = {
				...current,
				[key]: value,
			};

			if (key === "agentCount") {
				next.traderDistribution = buildDefaultTraderDistribution(value);
			}

			return next;
		});
	}

	function updateDistribution(key: TraderDistributionKey, value: number) {
		setForm((current) => ({
			...current,
			traderDistribution: {
				...current.traderDistribution,
				[key]: value,
			},
		}));
	}

	async function handleCreateSession() {
		setIsCreating(true);
		try {
			const result = await createSimulationSessionFn({
				data: form,
			});
			setIsConfigOpen(false);
			await navigate({
				to: "/dashboard/$sessionId",
				params: { sessionId: result.sessionId },
			});
		} finally {
			setIsCreating(false);
		}
	}

	return (
		<main className="mx-auto flex min-h-[calc(100vh-9rem)] w-full max-w-6xl flex-col px-4 py-8">
			<section className="rounded-3xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] p-6 shadow-sm">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<div className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--terminal-text-muted)]">
							Simulation Sessions
						</div>
						<h1 className="mt-3 text-3xl font-semibold text-[var(--terminal-text)]">
							Session-based market replays
						</h1>
						<p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--terminal-text-muted)]">
							Open a past run or start a new simulation session. Each session keeps
							its own market state, research feed, and selected symbol URL.
						</p>
					</div>
					<div className="flex flex-col items-start gap-2">
						<Button onClick={() => setIsConfigOpen(true)}>
							New Session
						</Button>
						<div className="text-xs text-[var(--terminal-text-muted)]">
							Configure symbol count, tick timing, and trader mix in the launch modal.
						</div>
					</div>
				</div>
			</section>

			{isConfigOpen ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
					role="dialog"
					aria-modal="true"
					aria-labelledby="simulation-config-title"
					onClick={() => {
						if (!isCreating) {
							setIsConfigOpen(false);
						}
					}}
				>
					<div
						className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-3xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] p-6 shadow-2xl"
						onClick={(event) => event.stopPropagation()}
					>
						<div className="flex flex-col gap-3 border-b border-[var(--terminal-border)] pb-5 sm:flex-row sm:items-start sm:justify-between">
							<div>
								<div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--terminal-text-muted)]">
									Launch Config
								</div>
								<h2
									id="simulation-config-title"
									className="mt-2 text-2xl font-semibold text-[var(--terminal-text)]"
								>
									Start a new simulation session
								</h2>
								<p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--terminal-text-muted)]">
									Set the runtime shape before the session is created. These values
									are persisted with the session and used by the runner on startup.
								</p>
							</div>
							<Button
								variant="ghost"
								onClick={() => setIsConfigOpen(false)}
								disabled={isCreating}
							>
								Close
							</Button>
						</div>

						<div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
							<div className="grid gap-4 sm:grid-cols-2">
								<label className="grid gap-2 text-sm text-[var(--terminal-text-muted)]">
									<span>Symbol Count</span>
									<input
										className="rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-3 py-2 text-[var(--terminal-text)]"
										type="number"
										min={1}
										max={10}
										value={form.symbolCount}
										onChange={(event) =>
											updateNumberField(
												"symbolCount",
												Number(event.target.value) || 1,
											)
										}
									/>
								</label>
								<label className="grid gap-2 text-sm text-[var(--terminal-text-muted)]">
									<span>Agent Count</span>
									<input
										className="rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-3 py-2 text-[var(--terminal-text)]"
										type="number"
										min={1}
										max={250}
										value={form.agentCount}
										onChange={(event) =>
											updateNumberField(
												"agentCount",
												Number(event.target.value) || 1,
											)
										}
									/>
								</label>
								<label className="grid gap-2 text-sm text-[var(--terminal-text-muted)]">
									<span>Active Agents Per Tick</span>
									<input
										className="rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-3 py-2 text-[var(--terminal-text)]"
										type="number"
										min={1}
										max={250}
										value={form.activeGroupSize}
										onChange={(event) =>
											updateNumberField(
												"activeGroupSize",
												Number(event.target.value) || 1,
											)
										}
									/>
								</label>
								<label className="grid gap-2 text-sm text-[var(--terminal-text-muted)]">
									<span>Tick Interval (ms)</span>
									<input
										className="rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-3 py-2 text-[var(--terminal-text)]"
										type="number"
										min={0}
										max={60000}
										value={form.tickIntervalMs}
										onChange={(event) =>
											updateNumberField(
												"tickIntervalMs",
												Number(event.target.value) || 0,
											)
										}
									/>
								</label>
								<label className="grid gap-2 text-sm text-[var(--terminal-text-muted)] sm:col-span-2">
									<span>Simulated Seconds Per Tick</span>
									<input
										className="rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-3 py-2 text-[var(--terminal-text)]"
										type="number"
										min={1}
										max={3600}
										value={form.simulatedTickDuration}
										onChange={(event) =>
											updateNumberField(
												"simulatedTickDuration",
												Number(event.target.value) || 1,
											)
										}
									/>
								</label>
							</div>

							<div className="grid gap-4">
								<div>
									<div className="text-sm font-semibold text-[var(--terminal-text)]">
										Trader Distribution
									</div>
									<div className="mt-1 text-xs text-[var(--terminal-text-muted)]">
										These counts must add up to the agent count. Current total:{" "}
										{distributionTotal}. Derived groups: {derivedGroupCount}.
									</div>
								</div>
								<div className="grid gap-3 sm:grid-cols-2">
									{TRADER_DISTRIBUTION_KEYS.map((key) => (
										<label
											key={key}
											className="grid gap-2 text-sm text-[var(--terminal-text-muted)]"
										>
											<span>{TRADER_DISTRIBUTION_LABELS[key]}</span>
											<input
												className="rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-3 py-2 text-[var(--terminal-text)]"
												type="number"
												min={0}
												max={key === "tier1" ? 2 : 250}
												value={form.traderDistribution[key]}
												onChange={(event) =>
													updateDistribution(
														key,
														Number(event.target.value) || 0,
													)
												}
											/>
										</label>
									))}
								</div>
							</div>
						</div>

						<div className="mt-6 flex flex-col gap-3 border-t border-[var(--terminal-border)] pt-5 sm:flex-row sm:items-center sm:justify-between">
							<div className="text-xs text-[var(--terminal-text-muted)]">
								{distributionMismatch
									? "Adjust the trader mix so the total matches the agent count."
									: "The runner will derive group count from the active-agents-per-tick target and persist this launch config with the session."}
							</div>
							<div className="flex items-center gap-2">
								<Button
									variant="ghost"
									onClick={() => setIsConfigOpen(false)}
									disabled={isCreating}
								>
									Cancel
								</Button>
								<Button
									disabled={isCreating || distributionMismatch}
									onClick={() => void handleCreateSession()}
								>
									{isCreating ? "Starting..." : "Start Session"}
								</Button>
							</div>
						</div>
					</div>
				</div>
			) : null}

			<section className="mt-6 overflow-hidden rounded-3xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)]">
				<div className="grid grid-cols-[1.6fr_120px_120px_180px] gap-4 border-b border-[var(--terminal-border)] px-6 py-4 text-[11px] uppercase tracking-[0.16em] text-[var(--terminal-text-muted)]">
					<span>Session</span>
					<span>Status</span>
					<span>Tick</span>
					<span className="text-right">Action</span>
				</div>

				{sessions.length === 0 ? (
					<div className="px-6 py-10 text-sm text-[var(--terminal-text-muted)]">
						No sessions yet. Create one to start the simulation runner.
					</div>
				) : (
					sessions.map((session) => (
						<div
							key={session.id}
							className="grid grid-cols-[1.6fr_120px_120px_180px] gap-4 border-b border-[var(--terminal-border)] px-6 py-5 text-sm text-[var(--terminal-text)] last:border-b-0"
						>
							<div className="min-w-0">
								<div className="truncate font-semibold">{session.name}</div>
								<div className="mt-1 truncate text-xs text-[var(--terminal-text-muted)]">
									{session.id}
								</div>
							</div>
							<div className="capitalize text-[var(--terminal-text-muted)]">
								{session.status}
							</div>
							<div className="text-[var(--terminal-text-muted)]">
								{session.currentTick}
							</div>
							<div className="text-right">
								<Button asChild variant="outline" size="sm">
									<Link
										to="/dashboard/$sessionId"
										params={{ sessionId: session.id }}
									>
										Open
									</Link>
								</Button>
							</div>
						</div>
					))
				)}
			</section>
		</main>
	);
}
