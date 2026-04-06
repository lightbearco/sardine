import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MaximizeButton } from "#/components/dashboard/MaximizeButton";
import { useSessionDashboard } from "#/hooks/useSessionDashboard";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";
import { useWatchlistSummary } from "#/hooks/useWatchlistSummary";
import { DEV_TICKERS } from "#/lib/constants";
import type { TickerConfig } from "#/lib/constants";
import type { SessionWatchlistEntry } from "#/types/sim";
import type { WatchlistSummaryPayload } from "#/types/watchlist";

function fmt(value: unknown) {
	const n = Number(value);
	return Number.isNaN(n) ? "—" : n.toFixed(2);
}

function fmtVol(value: number) {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
}

const WatchlistRow = memo(function WatchlistRow({
	ticker,
	selected,
	onSelect,
	summary,
	fallback,
}: {
	ticker: TickerConfig;
	selected: boolean;
	onSelect: (symbol: string) => void;
	summary?: WatchlistSummaryPayload;
	fallback?: SessionWatchlistEntry | null;
}) {
	const lastBar = summary?.lastBar ?? fallback?.lastBar ?? undefined;
	const snapshot = summary?.snapshot ?? fallback?.snapshot ?? undefined;
	const lastPrice =
		summary?.lastPrice ??
		snapshot?.lastPrice ??
		(lastBar ? lastBar.close : null);
	const high = summary?.high ?? lastBar?.high ?? null;
	const low = summary?.low ?? lastBar?.low ?? null;
	const changePct =
		lastBar && lastBar.open && lastBar.close && lastBar.open > 0
			? ((lastBar.close - lastBar.open) / lastBar.open) * 100
			: null;
	const positive = changePct !== null && changePct >= 0;
	const spread = summary?.spread ?? snapshot?.spread ?? null;
	const volume = lastBar?.volume ?? null;
	const divergencePct =
		summary?.divergencePct ?? fallback?.divergencePct ?? null;

	return (
		<button
			type="button"
			onClick={() => onSelect(ticker.symbol)}
			className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
				selected
					? "bg-accent text-accent-foreground"
					: "text-[var(--terminal-text)] hover:bg-white/5"
			}`}
		>
			{/* Row 1: symbol + price + change */}
			<div className="flex items-center justify-between gap-1">
				<span className="font-semibold">{ticker.symbol}</span>
				{divergencePct != null && (
					<span
						className="inline-flex items-center rounded px-1 text-[9px] font-semibold leading-none"
						style={{
							color: divergenceColor(divergencePct),
							backgroundColor: `${divergenceColor(divergencePct)}18`,
						}}
					>
						{Math.abs(divergencePct).toFixed(1)}%
					</span>
				)}
				<span className="font-mono tabular-nums">{fmt(lastPrice)}</span>
				<span
					className="w-14 text-right tabular-nums text-[11px] font-semibold"
					style={{
						color:
							changePct === null
								? "var(--terminal-text-muted)"
								: positive
									? "var(--terminal-green)"
									: "var(--terminal-red)",
					}}
				>
					{changePct === null
						? "—"
						: `${positive ? "+" : ""}${changePct.toFixed(2)}%`}
				</span>
			</div>
			{/* Row 2: H/L + volume + spread */}
			<div className="mt-0.5 flex items-center justify-between gap-1 text-[10px] text-[var(--terminal-text-muted)]">
				<span>
					{lastBar ? (
						<>
							<span style={{ color: "var(--terminal-green)" }}>
								{fmt(high)}
							</span>
							{" / "}
							<span style={{ color: "var(--terminal-red)" }}>{fmt(low)}</span>
						</>
					) : (
						"— / —"
					)}
				</span>
				<span>{volume !== null ? fmtVol(volume) : "—"}</span>
				<span>spd {fmt(spread)}</span>
			</div>
		</button>
	);
});

export function Watchlist() {
	const parentRef = useRef<HTMLDivElement | null>(null);
	const { symbol, setSymbol } = useSymbolSelection();
	const { summaries } = useWatchlistSummary();
	const { session, watchlist } = useSessionDashboard();
	const watchlistEntries = watchlist;
	const tickers = session.symbols
		.map(
			(sessionSymbol) =>
				DEV_TICKERS.find((ticker) => ticker.symbol === sessionSymbol) ?? {
					symbol: sessionSymbol,
					name: sessionSymbol,
				},
		)
		.filter((ticker): ticker is TickerConfig => ticker !== undefined);
	const rowVirtualizer = useVirtualizer({
		count: tickers.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 48,
		overscan: 5,
	});

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] overflow-hidden">
			<div className="flex items-center justify-between border-b border-[var(--terminal-border)] px-3 py-2 shrink-0">
				<span className="text-xs font-semibold text-[var(--terminal-text)]">
					Watchlist
				</span>
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] text-[var(--terminal-text-muted)]">
						{tickers.length} symbols
					</span>
					<MaximizeButton panelId="watchlist" />
				</div>
			</div>
			<div ref={parentRef} className="min-h-0 flex-1 overflow-auto px-2 py-1">
				<div
					className="relative w-full"
					style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
				>
					{rowVirtualizer.getVirtualItems().map((virtualItem) => {
						const ticker = tickers[virtualItem.index];
						if (!ticker) {
							return null;
						}
						return (
							<div
								key={ticker.symbol}
								className="absolute inset-x-0 top-0"
								style={{
									transform: `translateY(${virtualItem.start}px)`,
									height: virtualItem.size,
								}}
							>
								<WatchlistRow
									ticker={ticker}
									selected={symbol === ticker.symbol}
									onSelect={setSymbol}
									summary={summaries[ticker.symbol]}
									fallback={watchlistEntries[ticker.symbol] ?? null}
								/>
							</div>
						);
					})}
				</div>
			</div>
		</section>
	);
}
