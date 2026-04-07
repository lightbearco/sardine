import { useRef } from "react";
import { Badge } from "#/components/ui/badge";
import { MaximizeButton } from "#/components/dashboard/MaximizeButton";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAgentFeed } from "#/hooks/useAgentFeed";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import type { AgentEvent } from "#/types/sim";

function extractRow(event: ReturnType<typeof useAgentFeed>["events"][number]) {
	if (event.type === "signal") {
		return {
			tick: event.signal.tick,
			agent: event.agentName,
			side: event.signal.side.toUpperCase(),
			symbol: event.signal.symbol,
			price: event.signal.price === 0 ? "MKT" : event.signal.price.toFixed(2),
			qty: String(event.signal.qty),
			reasoning: event.signal.reasoning ?? "—",
		};
	}

	if (event.type === "decision") {
		const first = event.decision.ordersPlaced[0];
		return {
			tick: event.tick,
			agent: event.agentName,
			side: first?.side?.toUpperCase() ?? "INFO",
			symbol: first?.symbol ?? "—",
			price: first?.price ?? "—",
			qty: String(first?.qty ?? 0),
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
		reasoning: event.type === "failed" ? event.message : "Agent event",
	};
}

const SIDE_CLASS: Record<string, string> = {
	BUY: "bg-emerald-500/15 text-emerald-300 border-transparent",
	SELL: "bg-red-500/15 text-red-300 border-transparent",
	FAIL: "bg-red-500/15 text-red-300 border-transparent",
};

const COLS = "grid-cols-[48px_1.2fr_72px_60px_64px_44px_1.6fr]";

export function isBlotterEvent(event: AgentEvent): boolean {
	return (
		event.type === "signal" ||
		event.type === "decision" ||
		event.type === "failed"
	);
}

export function Blotter() {
	const { events } = useAgentFeed(200);
	const visibleEvents = events.filter(isBlotterEvent);
	const listRef = useRef<HTMLDivElement | null>(null);
	const virtualizer = useVirtualizer({
		count: visibleEvents.length,
		getScrollElement: () => listRef.current,
		estimateSize: () => 52,
		overscan: 6,
	});

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-(--terminal-border) bg-(--terminal-surface) overflow-hidden">
			<div className="flex items-center justify-between border-b border-(--terminal-border) px-3 py-2 shrink-0">
				<span className="text-xs font-semibold text-(--terminal-text)">
					Blotter
				</span>
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] text-(--terminal-text-muted)">
						{visibleEvents.length} events
					</span>
					<MaximizeButton panelId="blotter" />
				</div>
			</div>

			<div
				className={`grid ${COLS} items-center gap-2 border-b border-(--terminal-border) px-3 py-[3px] shrink-0`}
			>
				{["Tick", "Agent", "Side", "Sym", "Price", "Qty", "Reason"].map((h) => (
					<span
						key={h}
						className="text-[9px] uppercase tracking-widest text-(--terminal-text-muted)"
					>
						{h}
					</span>
				))}
			</div>

			<div ref={listRef} className="min-h-0 flex-1 overflow-auto">
				<div
					style={{
						height: `${virtualizer.getTotalSize()}px`,
						position: "relative",
					}}
				>
					{virtualizer.getVirtualItems().map((virtualRow) => {
						const event = visibleEvents[virtualRow.index];
						if (!event) {
							return null;
						}
						const row = extractRow(event);

						return (
							<div
								key={`${event.eventId ?? virtualRow.index}-${row.tick}-${row.agent}-${row.symbol}`}
								className="absolute inset-x-0 border-b border-(--terminal-border) hover:bg-white/5"
								style={{
									transform: `translateY(${virtualRow.start}px)`,
									height: virtualRow.size,
								}}
							>
								<button
									type="button"
									className={`grid w-full ${COLS} items-center gap-2 px-3 py-2 text-xs text-(--terminal-text) text-left`}
								>
									<span className="tabular-nums text-(--terminal-text-muted)">
										{row.tick}
									</span>
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="truncate text-[var(--terminal-text)]">
												{row.agent}
											</span>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											<span className="text-[11px] text-(--terminal-text)">
												{row.agent}
											</span>
										</TooltipContent>
									</Tooltip>
									<Badge
										className={
											SIDE_CLASS[row.side] ??
											"bg-secondary text-secondary-foreground"
										}
									>
										{row.side}
									</Badge>
									<span className="truncate">{row.symbol}</span>
									<span className="tabular-nums">{row.price}</span>
									<span className="tabular-nums">{row.qty}</span>
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="flex cursor-help items-center gap-1 truncate text-(--terminal-text-muted)">
												<span className="text-[10px] font-semibold">
													Reason
												</span>
												<span className="text-[10px] font-semibold text-(--terminal-text-muted)">
													?
												</span>
											</span>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											<p className="max-w-xs whitespace-pre-wrap text-[11px] leading-[1.4] text-(--terminal-text)">
												{row.reasoning}
											</p>
										</TooltipContent>
									</Tooltip>
								</button>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
