import { useEffect, useRef } from "react";
import { useTradesFeed } from "#/hooks/useTradesFeed";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";
import { ScrollArea } from "#/components/ui/scroll-area";

function formatPrice(value: unknown) {
	const parsed = Number(value);
	return Number.isNaN(parsed)
		? "—"
		: new Intl.NumberFormat("en-US", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(parsed);
}

export function TimeAndSales() {
	const { symbol } = useSymbolSelection();
	const { trades } = useTradesFeed(symbol);
	const bottomRef = useRef<HTMLDivElement | null>(null);
	const orderedTrades = [...trades].reverse();

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ block: "end" });
	}, [orderedTrades.length]);

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)]">
			<div className="border-b border-[var(--terminal-border)] px-4 py-3">
				<div className="text-sm font-semibold text-[var(--terminal-text)]">
					Time &amp; Sales
				</div>
				<div className="text-[11px] text-[var(--terminal-text-muted)]">
					{symbol} trade tape
				</div>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="space-y-1 p-3 font-mono text-xs">
					{orderedTrades.map((trade, index) => {
						const previous = orderedTrades[index - 1];
						const delta =
							previous === undefined
								? 0
								: Number(trade.price) - Number(previous.price);
						const color =
							delta > 0
								? "var(--terminal-green)"
								: delta < 0
									? "var(--terminal-red)"
									: "var(--terminal-text)";

						return (
							<div
								key={trade.id}
								className="grid grid-cols-[42px_1fr_52px] gap-3 rounded-md px-2 py-1 text-[var(--terminal-text-muted)] hover:bg-white/5"
							>
								<span>{trade.tick}</span>
								<span style={{ color }}>{formatPrice(trade.price)}</span>
								<span className="text-right">{trade.qty}</span>
							</div>
						);
					})}
					<div ref={bottomRef} />
				</div>
			</ScrollArea>
		</section>
	);
}
