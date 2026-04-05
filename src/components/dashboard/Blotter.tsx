import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAgentFeed } from "#/hooks/useAgentFeed";
import { Badge } from "#/components/ui/badge";
import {
	Table,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";

function extractRow(event: ReturnType<typeof useAgentFeed>["events"][number]) {
	if (event.type === "signal") {
		return {
			tick: event.signal.tick,
			agent: event.agentName,
			side: event.signal.side.toUpperCase(),
			symbol: event.signal.symbol,
			price: event.signal.price === 0 ? "MKT" : String(event.signal.price),
			qty: String(event.signal.qty),
			reasoning: event.signal.reasoning ?? "No reasoning provided",
		};
	}

	if (event.type === "decision") {
		const firstOrder = event.decision.ordersPlaced[0];
		return {
			tick: event.tick,
			agent: event.agentName,
			side: firstOrder?.side?.toUpperCase() ?? "INFO",
			symbol: firstOrder?.symbol ?? "—",
			price: firstOrder?.price ?? "—",
			qty: String(firstOrder?.qty ?? 0),
			reasoning: event.decision.reasoning,
		};
	}

	return {
		tick: event.tick,
		agent: event.agentName,
		side: event.type === "failed" ? "FAIL" : "INFO",
		symbol: "—",
		price: "—",
		qty: "—",
		reasoning:
			event.type === "failed"
				? event.message
				: event.type === "thinking_delta"
					? event.transcript
					: "Agent event",
	};
}

export function Blotter() {
	const { events } = useAgentFeed(200);
	const parentRef = useRef<HTMLDivElement | null>(null);
	const rowVirtualizer = useVirtualizer({
		count: events.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 40,
		overscan: 8,
	});

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)]">
			<div className="border-b border-[var(--terminal-border)] px-4 py-3">
				<div className="text-sm font-semibold text-[var(--terminal-text)]">
					Blotter
				</div>
				<div className="text-[11px] text-[var(--terminal-text-muted)]">
					Latest agent orders and signals
				</div>
			</div>
			<Table className="border-b border-[var(--terminal-border)] text-[var(--terminal-text)]">
				<TableHeader>
					<TableRow className="border-[var(--terminal-border)] hover:bg-transparent">
						<TableHead className="h-9 px-4 text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
							Tick
						</TableHead>
						<TableHead className="h-9 px-2 text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
							Agent
						</TableHead>
						<TableHead className="h-9 px-2 text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
							Side
						</TableHead>
						<TableHead className="h-9 px-2 text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
							Symbol
						</TableHead>
						<TableHead className="h-9 px-2 text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
							Price
						</TableHead>
						<TableHead className="h-9 px-2 text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
							Qty
						</TableHead>
						<TableHead className="h-9 px-2 text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
							Reasoning
						</TableHead>
					</TableRow>
				</TableHeader>
			</Table>
			<div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
				<div
					className="relative w-full"
					style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
				>
					{rowVirtualizer.getVirtualItems().map((virtualRow) => {
						const row = extractRow(events[virtualRow.index]);
						return (
							<div
								key={`${row.agent}-${virtualRow.index}`}
								className="absolute inset-x-0 top-0 border-b border-[var(--terminal-border)]"
								style={{ transform: `translateY(${virtualRow.start}px)` }}
							>
								<div className="grid grid-cols-[60px_1.2fr_90px_74px_72px_56px_1.6fr] items-center gap-2 px-4 py-2 text-xs text-[var(--terminal-text)]">
									<span>{row.tick}</span>
									<span className="truncate">{row.agent}</span>
									<Badge
										variant="secondary"
										className={
											row.side === "BUY"
												? "bg-emerald-500/15 text-emerald-300"
												: row.side === "SELL"
													? "bg-red-500/15 text-red-300"
													: row.side === "FAIL"
														? "bg-red-500/15 text-red-300"
														: "bg-secondary text-secondary-foreground"
										}
									>
										{row.side}
									</Badge>
									<span>{row.symbol}</span>
									<span>{row.price}</span>
									<span>{row.qty}</span>
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="truncate text-[var(--terminal-text-muted)]">
												{row.reasoning}
											</span>
										</TooltipTrigger>
										<TooltipContent side="top" className="max-w-sm">
											{row.reasoning}
										</TooltipContent>
									</Tooltip>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
