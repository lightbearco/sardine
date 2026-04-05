import { format } from "date-fns";
import { PauseIcon, PlayIcon, StepForwardIcon } from "lucide-react";
import { DEV_TICKERS } from "#/lib/constants";
import { useSimControls } from "#/hooks/useSimControls";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Separator } from "#/components/ui/separator";

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
	const { simState, play, pause, step, isConnected, setSpeed } = useSimControls();
	const ticker = DEV_TICKERS.find((item) => item.symbol === symbol);
	const latencyMs = simState?.lastSummary?.durationMs;
	const statusClassName = !isConnected
		? "border-[var(--terminal-border)] bg-[var(--terminal-bg)] text-[var(--terminal-text)]"
		: simState?.isRunning
			? "border-transparent bg-primary/15 text-primary-foreground"
			: "border-[var(--terminal-border)] bg-[var(--terminal-bg)] text-[var(--terminal-text)]";

	return (
		<header className="flex h-12 items-center gap-4 rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-4 text-[var(--terminal-text)] shadow-sm">
			<div className="min-w-0">
				<div className="text-sm font-semibold">{symbol}</div>
				<div className="truncate text-[11px] text-[var(--terminal-text-muted)]">
					{ticker?.name ?? "Unknown company"}
				</div>
			</div>

			<Separator
				orientation="vertical"
				className="!h-6 bg-[var(--terminal-border)]"
			/>

			<div className="flex min-w-0 flex-1 items-center gap-3 text-xs text-[var(--terminal-text-muted)]">
				<Badge className={statusClassName}>
					{isConnected
						? simState?.isRunning
							? "Running"
							: "Paused"
						: "Disconnected"}
				</Badge>
				<span>Tick {simState?.simTick ?? 0}</span>
				<span>{formatTimestamp(simState?.simulatedTime)}</span>
				<span>Latency {latencyMs ?? "—"} ms</span>
			</div>

			<div className="flex items-center gap-2">
				<Button size="icon-sm" variant="secondary" onClick={() => void play()}>
					<PlayIcon className="size-4" />
				</Button>
				<Button size="icon-sm" variant="secondary" onClick={() => void pause()}>
					<PauseIcon className="size-4" />
				</Button>
				<Button size="icon-sm" variant="secondary" onClick={() => void step()}>
					<StepForwardIcon className="size-4" />
				</Button>
				<Select
					value={String(simState?.speedMultiplier ?? 1)}
					onValueChange={(value) => void setSpeed(Number(value))}
				>
					<SelectTrigger
						size="sm"
						className="w-24 border-[var(--terminal-border)] bg-background text-[var(--terminal-text)]"
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
			</div>
		</header>
	);
}
