import { useEffect, useRef } from "react";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";
import { useTradesFeed } from "#/hooks/useTradesFeed";

function fmt(value: unknown) {
	const n = Number(value);
	return Number.isNaN(n) ? "—" : n.toFixed(2);
}

function fmtQty(value: number) {
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
}

export function TimeAndSales() {
	const { symbol } = useSymbolSelection();
	const { trades } = useTradesFeed(symbol);
	const bottomRef = useRef<HTMLDivElement | null>(null);
	const ordered = [...trades].reverse();
	const tradeCount = trades.length;

	useEffect(() => {
		if (tradeCount > 0) bottomRef.current?.scrollIntoView({ block: "end" });
	}, [tradeCount]);

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-(--terminal-border) bg-(--terminal-surface) overflow-hidden">
			<div className="flex items-center justify-between border-b border-(--terminal-border) px-3 py-2 shrink-0">
				<span className="text-xs font-semibold text-(--terminal-text)">Time &amp; Sales</span>
				<span className="text-[10px] text-(--terminal-text-muted)">{symbol} · {trades.length} trades</span>
			</div>

			<div className="flex items-center border-b border-(--terminal-border) px-2 py-[3px] shrink-0">
				<span className="w-10 text-[9px] uppercase tracking-widest text-(--terminal-text-muted)">Tick</span>
				<span className="flex-1 text-[9px] uppercase tracking-widest text-(--terminal-text-muted)">Price</span>
				<span className="w-10 text-right text-[9px] uppercase tracking-widest text-(--terminal-text-muted)">Size</span>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto font-mono">
				{ordered.map((trade, index) => {
					const prev = ordered[index + 1];
					const delta = prev ? Number(trade.price) - Number(prev.price) : 0;
					const up = delta > 0;
					const down = delta < 0;
					const color = up
						? "var(--terminal-green)"
						: down
							? "var(--terminal-red)"
							: "var(--terminal-text-muted)";

					return (
						<div key={trade.id} className="flex items-center px-2 py-[3px] text-xs hover:bg-white/5">
							<span className="w-10 text-(--terminal-text-muted)">{trade.tick}</span>
							<span className="flex-1 tabular-nums font-semibold" style={{ color }}>
								{up ? "▲" : down ? "▼" : " "} {fmt(trade.price)}
							</span>
							<span className="w-10 text-right tabular-nums text-(--terminal-text)">{fmtQty(trade.qty)}</span>
						</div>
					);
				})}
				<div ref={bottomRef} />
			</div>

			{trades.length > 0 && (
				<div className="shrink-0 border-t border-(--terminal-border) px-3 py-1.5 flex justify-between text-[10px] text-(--terminal-text-muted)">
					<span>Total vol</span>
					<span className="tabular-nums text-(--terminal-text)">{fmtQty(trades.reduce((s, t) => s + t.qty, 0))}</span>
				</div>
			)}
		</section>
	);
}
