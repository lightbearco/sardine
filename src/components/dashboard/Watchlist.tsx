import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DEV_TICKERS, type TickerConfig } from "#/lib/constants";
import { useMarketData } from "#/hooks/useMarketData";
import { useOrderBook } from "#/hooks/useOrderBook";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";

function formatPrice(value: unknown) {
	const parsed = Number(value);
	return Number.isNaN(parsed)
		? "—"
		: new Intl.NumberFormat("en-US", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(parsed);
}

const WatchlistRow = memo(function WatchlistRow({
	ticker,
	selected,
	onSelect,
}: {
	ticker: TickerConfig;
	selected: boolean;
	onSelect: (symbol: string) => void;
}) {
	const { lastBar } = useMarketData(ticker.symbol);
	const { snapshot } = useOrderBook(ticker.symbol);
	const open = lastBar ? Number(lastBar.open) : null;
	const close = lastBar ? Number(lastBar.close) : null;
	const changePct =
		open && close ? (((close - open) / open) * 100).toFixed(2) : "—";
	const spread = snapshot?.spread ? formatPrice(snapshot.spread) : "—";

	return (
		<button
			type="button"
			onClick={() => onSelect(ticker.symbol)}
			className={`grid w-full grid-cols-[64px_1fr_64px_72px_64px] gap-2 rounded-md px-3 py-2 text-left text-xs transition-colors ${
				selected
					? "bg-accent text-accent-foreground"
					: "text-[var(--terminal-text)] hover:bg-white/5"
			}`}
		>
			<div className="font-semibold">{ticker.symbol}</div>
			<div className="truncate">{formatPrice(snapshot?.lastPrice ?? close)}</div>
			<div
				className={
					changePct === "—"
						? "text-[var(--terminal-text-muted)]"
						: Number(changePct) >= 0
							? "text-[var(--terminal-green)]"
							: "text-[var(--terminal-red)]"
				}
			>
				{changePct === "—" ? changePct : `${changePct}%`}
			</div>
			<div className="text-[var(--terminal-text-muted)]">
				{lastBar?.volume
					? new Intl.NumberFormat("en-US", {
							maximumFractionDigits: 0,
						}).format(lastBar.volume)
					: "—"}
			</div>
			<div className="text-[var(--terminal-text-muted)]">{spread}</div>
		</button>
	);
});

export function Watchlist() {
	const parentRef = useRef<HTMLDivElement | null>(null);
	const { symbol, setSymbol } = useSymbolSelection();
	const rowVirtualizer = useVirtualizer({
		count: DEV_TICKERS.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 36,
		overscan: 5,
	});

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)]">
			<div className="border-b border-[var(--terminal-border)] px-4 py-3">
				<div className="text-sm font-semibold text-[var(--terminal-text)]">
					Watchlist
				</div>
				<div className="text-[11px] text-[var(--terminal-text-muted)]">
					Last / Change / Volume / Spread
				</div>
			</div>
			<div ref={parentRef} className="min-h-0 flex-1 overflow-auto">
				<div
					className="relative w-full"
					style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
				>
					{rowVirtualizer.getVirtualItems().map((virtualItem) => {
						const ticker = DEV_TICKERS[virtualItem.index];
						return (
							<div
								key={ticker.symbol}
								className="absolute inset-x-0 top-0"
								style={{ transform: `translateY(${virtualItem.start}px)` }}
							>
								<WatchlistRow
									ticker={ticker}
									selected={symbol === ticker.symbol}
									onSelect={setSymbol}
								/>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
