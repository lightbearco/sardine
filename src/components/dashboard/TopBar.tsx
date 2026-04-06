import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import {
	ChevronLeftIcon,
	PauseIcon,
	PlayIcon,
	Settings2Icon,
	StepForwardIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "#/components/ui/badge";
import { DeleteSimulationDialog } from "#/components/dashboard/DeleteSimulationDialog";
import { Button } from "#/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Separator } from "#/components/ui/separator";
import { useSessionDashboard } from "#/hooks/useSessionDashboard";
import { useSimControls } from "#/hooks/useSimControls";
import { deleteSimulationSessionFn } from "#/hooks/useSimulationSessions";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";
import { DEV_TICKERS } from "#/lib/constants";
import {
	TRADER_DISTRIBUTION_KEYS,
	TRADER_DISTRIBUTION_LABELS,
} from "#/lib/simulation-session";

const SPEED_OPTIONS = [0.5, 1, 2, 5, 10];

function formatTimestamp(value: Date | null | undefined) {
	if (!value) {
		return "Waiting for sim";
	}

	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime())
		? "Waiting for sim"
		: format(date, "MMM d, HH:mm:ss");
}

export function TopBar() {
	const { symbol } = useSymbolSelection();
	const { session, isLive } = useSessionDashboard();
	const navigate = useNavigate();
	const router = useRouter();
	const { simState, play, pause, step, isConnected, setSpeed } =
		useSimControls();
	const [isConfigOpen, setIsConfigOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isPausing, setIsPausing] = useState(false);
	const ticker = DEV_TICKERS.find((item) => item.symbol === symbol);
	const latencyMs = simState?.lastSummary?.durationMs;
	const isRunning = (simState?.isRunning ?? false) && !isPausing;
	const isDeletingSession = session.status === "deleting";
	const hasRuntime = simState !== null;
	const isControllableLiveSession =
		session.status === "active" && isLive && hasRuntime && isConnected;
	const canTogglePlayback = isControllableLiveSession;
	const canStep = isControllableLiveSession && !isRunning;
	const canAdjustSpeed = isControllableLiveSession;

	useEffect(() => {
		if (!simState?.isRunning) {
			setIsPausing(false);
		}
	}, [simState?.isRunning]);

	const handleTogglePlayback = async () => {
		if (isRunning) {
			setIsPausing(true);
		}
		await (isRunning ? pause : play)();
	};

	const statusLabel =
		session.status === "deleting"
			? "Deleting"
			: session.status === "completed" || session.status === "failed"
				? "Historical"
				: session.status === "pending"
					? "Queued"
					: session.status === "suspended"
						? "Suspended"
						: !isConnected
							? "Disconnected"
							: isRunning
								? "Running"
								: "Paused";
	const statusClassName =
		statusLabel === "Running"
			? "border-transparent bg-primary/15 text-primary-foreground"
			: statusLabel === "Deleting"
				? "border-red-500/30 bg-red-500/10 text-red-200"
				: statusLabel === "Queued" || statusLabel === "Suspended"
					? "border-amber-500/30 bg-amber-500/10 text-amber-200"
					: "border-[var(--terminal-border)] bg-[var(--terminal-bg)] text-[var(--terminal-text-muted)]";
	const statusHint =
		session.status === "deleting"
			? "Session delete is in progress. Runtime cleanup finishes before the data is removed."
			: session.status === "pending"
				? "Queued for the runner. It will start when capacity is available."
				: session.status === "suspended"
					? "Temporarily paused for capacity. Will auto-resume."
					: session.status === "active" && !isConnected
						? "Simulation runner is offline. Start the sim worker and this active session will auto-resume."
						: null;

	async function handleDeleteSession() {
		setIsDeleting(true);
		try {
			await deleteSimulationSessionFn({
				data: {
					sessionId: session.id,
				},
			});
			setIsDeleteDialogOpen(false);
			await navigate({
				to: "/dashboard",
			});
			await router.invalidate();
		} finally {
			setIsDeleting(false);
		}
	}

	return (
		<>
			<header className="flex h-12 items-center gap-4 rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-4 text-[var(--terminal-text)] shadow-sm">
				<Button asChild size="icon-sm" variant="ghost">
					<Link
						to="/dashboard"
						aria-label="Back to simulation sessions"
						className="shrink-0"
					>
						<ChevronLeftIcon className="size-4" />
					</Link>
				</Button>

				<Separator
					orientation="vertical"
					className="h-full bg-(--terminal-border)"
				/>
				<div className="flex items-center">
					<img
						src="/sardine-logo-white.png"
						alt="Sardine"
						className="size-10"
					/>
					<span className="truncate font-semibold tracking-tighter text-xl text-white">
						Sardine
					</span>
				</div>

				<Separator
					orientation="vertical"
					className="h-full bg-(--terminal-border)"
				/>
				<div className="min-w-0">
					<div className="text-sm font-semibold">{symbol}</div>
					<div className="truncate text-[11px] text-[var(--terminal-text-muted)]">
						{ticker?.name ?? "Unknown company"} · {session.name}
					</div>
				</div>

				<Separator
					orientation="vertical"
					className="h-full bg-(--terminal-border)"
				/>

				<div className="flex min-w-0 flex-1 items-center gap-3 text-xs text-[var(--terminal-text-muted)]">
					<Badge className={statusClassName}>{statusLabel}</Badge>
					<span>Tick {simState?.simTick ?? 0}</span>
					<span>{formatTimestamp(simState?.simulatedTime)}</span>
					<span>Latency {latencyMs ?? "—"} ms</span>
					{statusHint ? (
						<span className="truncate text-amber-200">{statusHint}</span>
					) : null}
				</div>

				<div className="flex items-center gap-2">
					<Button
						size="icon-sm"
						variant="ghost"
						disabled={isDeletingSession}
						onClick={() => setIsConfigOpen(true)}
						aria-label="Open simulation configuration"
					>
						<Settings2Icon className="size-4" />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={!canTogglePlayback}
						onClick={() => void handleTogglePlayback()}
						aria-label={isRunning ? "Pause Simulation" : "Play Simulation"}
					>
						{isRunning ? (
							<PauseIcon className="mr-1.5 size-4" />
						) : (
							<PlayIcon className="mr-1.5 size-4" />
						)}
						{isRunning ? "Pause" : "Play"}
					</Button>
					<Button
						size="icon-sm"
						variant="ghost"
						disabled={!canStep}
						onClick={() => void step()}
						aria-label="Step simulation"
					>
						<StepForwardIcon className="size-4" />
					</Button>
					<Select
						value={String(simState?.speedMultiplier ?? 1)}
						disabled={!canAdjustSpeed}
						onValueChange={(value) => void setSpeed(Number(value))}
					>
						<SelectTrigger
							size="sm"
							className="w-24 border-none bg-transparent"
						>
							<SelectValue placeholder="Speed" />
						</SelectTrigger>
						<SelectContent>
							{SPEED_OPTIONS.map((speed) => (
								<SelectItem key={speed} value={String(speed)}>
									{speed}x
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						size="sm"
						variant="destructive"
						disabled={isDeletingSession || isDeleting}
						onClick={() => setIsDeleteDialogOpen(true)}
					>
						<Trash2Icon className="mr-1.5 size-4" />
						{isDeleting ? "Deleting..." : "Delete"}
					</Button>
				</div>
			</header>

			{isConfigOpen ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
					role="dialog"
					aria-modal="true"
					aria-labelledby="live-sim-config-title"
					onClick={() => setIsConfigOpen(false)}
				>
					<div
						className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-3xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] p-6 shadow-2xl"
						onClick={(event) => event.stopPropagation()}
					>
						<div className="flex items-start justify-between gap-4 border-b border-[var(--terminal-border)] pb-4">
							<div>
								<div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--terminal-text-muted)]">
									Simulation Config
								</div>
								<h2
									id="live-sim-config-title"
									className="mt-2 text-2xl font-semibold text-[var(--terminal-text)]"
								>
									{session.name}
								</h2>
								<p className="mt-2 text-sm text-[var(--terminal-text-muted)]">
									These are the persisted launch settings for the current live
									dashboard session.
								</p>
							</div>
							<Button
								size="icon-sm"
								variant="ghost"
								onClick={() => setIsConfigOpen(false)}
								aria-label="Close simulation configuration"
							>
								<XIcon className="size-4" />
							</Button>
						</div>

						<div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
							<div className="grid gap-3">
								<div className="text-sm font-semibold text-[var(--terminal-text)]">
									Launch Settings
								</div>
								<div className="grid gap-2 text-sm text-[var(--terminal-text-muted)]">
									<div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--terminal-border)] px-3 py-2">
										<span>Symbols</span>
										<span className="font-medium text-[var(--terminal-text)]">
											{session.symbols.length}
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--terminal-border)] px-3 py-2">
										<span>Agents</span>
										<span className="font-medium text-[var(--terminal-text)]">
											{session.agentCount}
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--terminal-border)] px-3 py-2">
										<span>Groups</span>
										<span className="font-medium text-[var(--terminal-text)]">
											{session.groupCount}
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--terminal-border)] px-3 py-2">
										<span>Tick Interval</span>
										<span className="font-medium text-[var(--terminal-text)]">
											{session.tickIntervalMs} ms
										</span>
									</div>
									<div className="flex items-center justify-between gap-4 rounded-xl border border-[var(--terminal-border)] px-3 py-2">
										<span>Simulated Time Per Tick</span>
										<span className="font-medium text-[var(--terminal-text)]">
											{session.simulatedTickDuration}s
										</span>
									</div>
								</div>
							</div>

							<div className="grid gap-3">
								<div className="text-sm font-semibold text-[var(--terminal-text)]">
									Trader Mix
								</div>
								<div className="grid gap-2 text-sm text-[var(--terminal-text-muted)]">
									{TRADER_DISTRIBUTION_KEYS.map((key) => (
										<div
											key={key}
											className="flex items-center justify-between gap-4 rounded-xl border border-[var(--terminal-border)] px-3 py-2"
										>
											<span>{TRADER_DISTRIBUTION_LABELS[key]}</span>
											<span className="font-medium text-[var(--terminal-text)]">
												{session.traderDistribution[key]}
											</span>
										</div>
									))}
								</div>
							</div>
						</div>
					</div>
				</div>
			) : null}

			{isDeleteDialogOpen ? (
				<DeleteSimulationDialog
					sessionName={session.name}
					isDeleting={isDeleting}
					onCancel={() => {
						if (!isDeleting) {
							setIsDeleteDialogOpen(false);
						}
					}}
					onConfirm={() => void handleDeleteSession()}
				/>
			) : null}
		</>
	);
}
