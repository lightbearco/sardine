import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { useAgentFeed } from "#/hooks/useAgentFeed";

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
		reasoning:
			event.type === "failed"
				? event.message
				: event.type === "thinking_delta"
					? event.transcript
					: "Agent event",
	};
}

const SIDE_CLASS: Record<string, string> = {
	BUY: "bg-emerald-500/15 text-emerald-300 border-transparent",
	SELL: "bg-red-500/15 text-red-300 border-transparent",
	FAIL: "bg-red-500/15 text-red-300 border-transparent",
};

const COLS = "grid-cols-[48px_1.2fr_72px_60px_64px_44px_1.6fr_12px]";

export function Blotter() {
	const { events } = useAgentFeed(200);
	const [expandedIndexes, setExpandedIndexes] = useState<Set<number>>(new Set());

	function toggleRow(index: number) {
		setExpandedIndexes((prev) => {
			const next = new Set(prev);
			if (next.has(index)) next.delete(index);
			else next.add(index);
			return next;
		});
	}

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-(--terminal-border) bg-(--terminal-surface) overflow-hidden">
			<div className="flex items-center justify-between border-b border-(--terminal-border) px-3 py-2 shrink-0">
				<span className="text-xs font-semibold text-(--terminal-text)">Blotter</span>
				<span className="text-[10px] text-(--terminal-text-muted)">{events.length} events</span>
			</div>

			<div className={`grid ${COLS} items-center gap-2 border-b border-(--terminal-border) px-3 py-[3px] shrink-0`}>
				{["Tick", "Agent", "Side", "Sym", "Price", "Qty", "Reasoning", ""].map((h) => (
					<span key={h} className="text-[9px] uppercase tracking-widest text-(--terminal-text-muted)">{h}</span>
				))}
			</div>

			<div className="min-h-0 flex-1 overflow-auto">
				<div className="space-y-px">
					{events.map((event, index) => {
						const row = extractRow(event);
						const rowKey = `${row.tick}-${row.agent}-${row.side}-${row.symbol}`;
						const isExpanded = expandedIndexes.has(index);
						return (
							<div key={rowKey} className="border-b border-(--terminal-border) hover:bg-white/5">
								<button
									type="button"
									onClick={() => toggleRow(index)}
									className={`grid w-full ${COLS} items-center gap-2 px-3 py-2 text-xs text-(--terminal-text) text-left`}
								>
									<span className="tabular-nums text-(--terminal-text-muted)">{row.tick}</span>
									<span className="truncate">{row.agent}</span>
									<Badge className={SIDE_CLASS[row.side] ?? "bg-secondary text-secondary-foreground"}>
										{row.side}
									</Badge>
									<span className="truncate">{row.symbol}</span>
									<span className="tabular-nums">{row.price}</span>
									<span className="tabular-nums">{row.qty}</span>
									<span className="truncate text-(--terminal-text-muted)">{row.reasoning}</span>
									<span className="text-[10px] text-(--terminal-text-muted)">{isExpanded ? "▲" : "▼"}</span>
								</button>
								{isExpanded && (
									<div className="border-t border-(--terminal-border) px-3 py-2">
										<p className="whitespace-pre-wrap text-[11px] leading-[1.6] text-(--terminal-text-muted)">
											{row.reasoning}
										</p>
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
