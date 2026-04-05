import { useMemo } from "react";
import { useMarketData } from "#/hooks/useMarketData";
import { useOrderBook } from "#/hooks/useOrderBook";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";
import type { PriceLevelData } from "#/types/market";

function fmt(value: unknown, decimals = 2) {
	const n = Number(value);
	return Number.isNaN(n) ? "—" : n.toFixed(decimals);
}

function fmtQty(value: number) {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
}

function fmtPct(value: number) {
	const sign = value >= 0 ? "+" : "";
	return `${sign}${value.toFixed(2)}%`;
}

function DepthRows({ rows, tone }: { rows: PriceLevelData[]; tone: "buy" | "sell" }) {
	const totalQty = useMemo(() => rows.reduce((s, r) => s + r.qty, 0), [rows]);
	const color = tone === "buy" ? "var(--terminal-green)" : "var(--terminal-red)";

	let cumulative = 0;
	return (
		<>
			{rows.map((row) => {
				cumulative += row.qty;
				const depthPct = totalQty > 0 ? (cumulative / totalQty) * 100 : 0;
				const sizePct = totalQty > 0 ? (row.qty / totalQty) * 100 : 0;
				return (
					<div
						key={`${tone}-${row.price}`}
						className="group relative flex items-center gap-1 px-2 py-[3px] text-xs hover:bg-white/5"
					>
						{/* Depth fill */}
						<div
							className="absolute inset-y-0 right-0 opacity-10"
							style={{ width: `${depthPct}%`, backgroundColor: color }}
						/>
						{/* Size fill (brighter, narrower) */}
						<div
							className="absolute inset-y-0 right-0 opacity-20"
							style={{ width: `${sizePct}%`, backgroundColor: color }}
						/>
						{/* Price */}
						<span className="relative w-[42%] font-mono font-semibold tabular-nums" style={{ color }}>
							{fmt(row.price)}
						</span>
						{/* Orders */}
						<span className="relative w-[18%] text-center tabular-nums text-[var(--terminal-text-muted)]">
							{row.orderCount}
						</span>
						{/* Size */}
						<span className="relative w-[20%] text-right tabular-nums text-[var(--terminal-text)]">
							{fmtQty(row.qty)}
						</span>
						{/* Cumulative */}
						<span className="relative w-[20%] text-right tabular-nums text-[var(--terminal-text-muted)]">
							{fmtQty(cumulative)}
						</span>
					</div>
				);
			})}
		</>
	);
}

export function OrderBookPanel() {
	const { symbol } = useSymbolSelection();
	const { snapshot } = useOrderBook(symbol);
	const { lastBar } = useMarketData(symbol);

	const asks = useMemo(() => [...(snapshot?.asks ?? [])].reverse(), [snapshot]);
	const bids = snapshot?.bids ?? [];
	const lastPrice = snapshot?.lastPrice ?? lastBar?.close;
	const spread = snapshot?.spread;

	const totalBidQty = useMemo(() => bids.reduce((s, r) => s + r.qty, 0), [bids]);
	const totalAskQty = useMemo(() => asks.reduce((s, r) => s + r.qty, 0), [asks]);
	const totalQty = totalBidQty + totalAskQty;
	const bidPct = totalQty > 0 ? (totalBidQty / totalQty) * 100 : 50;
	const askPct = 100 - bidPct;

	const change = lastBar && lastBar.open > 0
		? ((lastBar.close - lastBar.open) / lastBar.open) * 100
		: null;
	const changePositive = change !== null && change >= 0;

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] overflow-hidden text-[var(--terminal-text)]">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-[var(--terminal-border)] px-3 py-2 shrink-0">
				<span className="text-xs font-semibold">Order Book</span>
				<div className="flex items-center gap-2">
					{change !== null && (
						<span
							className="text-[11px] font-semibold tabular-nums"
							style={{ color: changePositive ? "var(--terminal-green)" : "var(--terminal-red)" }}
						>
							{fmtPct(change)}
						</span>
					)}
					<span className="text-[10px] text-[var(--terminal-text-muted)]">{symbol}</span>
				</div>
			</div>

			{/* OHLCV stats */}
			{lastBar && (
				<div className="grid grid-cols-4 border-b border-[var(--terminal-border)] shrink-0">
					{(
						[
							["O", lastBar.open],
							["H", lastBar.high],
							["L", lastBar.low],
							["V", null],
						] as const
					).map(([label, val]) => (
						<div key={label} className="flex flex-col items-center py-1">
							<span className="text-[9px] uppercase tracking-widest text-[var(--terminal-text-muted)]">{label}</span>
							<span className="text-[11px] font-mono tabular-nums">
								{label === "V" ? fmtQty(lastBar.volume) : fmt(val)}
							</span>
						</div>
					))}
				</div>
			)}

			{/* Column labels */}
			<div className="flex items-center gap-1 border-b border-[var(--terminal-border)] px-2 py-[3px] shrink-0">
				<span className="w-[42%] text-[9px] uppercase tracking-widest text-[var(--terminal-text-muted)]">Price</span>
				<span className="w-[18%] text-center text-[9px] uppercase tracking-widest text-[var(--terminal-text-muted)]">Ords</span>
				<span className="w-[20%] text-right text-[9px] uppercase tracking-widest text-[var(--terminal-text-muted)]">Size</span>
				<span className="w-[20%] text-right text-[9px] uppercase tracking-widest text-[var(--terminal-text-muted)]">Cum</span>
			</div>

			{/* Asks */}
			<div className="min-h-0 flex-1 overflow-y-auto">
				<DepthRows rows={asks} tone="sell" />
			</div>

			{/* Mid price + spread */}
			<div className="flex items-center justify-between border-y border-[var(--terminal-border)] px-3 py-[5px] shrink-0">
				<span className="font-mono text-sm font-bold">{fmt(lastPrice)}</span>
				<span className="text-[10px] text-[var(--terminal-text-muted)]">
					spd {fmt(spread)}
				</span>
			</div>

			{/* Bids */}
			<div className="min-h-0 flex-1 overflow-y-auto">
				<DepthRows rows={bids} tone="buy" />
			</div>

			{/* Bid/ask imbalance bar */}
			<div className="shrink-0 border-t border-[var(--terminal-border)] px-3 py-2">
				<div className="mb-1 flex justify-between text-[10px] text-[var(--terminal-text-muted)]">
					<span style={{ color: "var(--terminal-green)" }}>B {bidPct.toFixed(0)}%</span>
					<span className="text-[var(--terminal-text-muted)]">Imbalance</span>
					<span style={{ color: "var(--terminal-red)" }}>{askPct.toFixed(0)}% A</span>
				</div>
				<div className="flex h-1.5 overflow-hidden rounded-full">
					<div
						className="h-full transition-all duration-300"
						style={{ width: `${bidPct}%`, backgroundColor: "var(--terminal-green)" }}
					/>
					<div
						className="h-full flex-1 transition-all duration-300"
						style={{ backgroundColor: "var(--terminal-red)" }}
					/>
				</div>
			</div>
		</section>
	);
}
