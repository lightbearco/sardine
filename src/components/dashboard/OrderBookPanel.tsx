import { useMemo } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { useMarketData } from "#/hooks/useMarketData";
import { useOrderBook } from "#/hooks/useOrderBook";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";
import { MarketStats } from "./MarketStats";

function formatPrice(value: unknown) {
	const parsed = Number(value);
	return Number.isNaN(parsed)
		? "—"
		: new Intl.NumberFormat("en-US", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(parsed);
}

function formatQty(value: unknown) {
	const parsed = Number(value);
	return Number.isNaN(parsed)
		? "—"
		: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(parsed);
}

type Row = { price: unknown; qty: number; orderCount?: unknown };

function DepthRows({
	rows,
	tone,
}: {
	rows: Row[];
	tone: "buy" | "sell";
}) {
	const maxQty = useMemo(
		() => Math.max(...rows.map((row) => Number(row.qty) || 0), 1),
		[rows],
	);

	return (
		<div className="space-y-1">
			{rows.map((row, index) => {
				const qty = Number(row.qty) || 0;
				const width = `${(qty / maxQty) * 100}%`;
				const color =
					tone === "buy"
						? "var(--terminal-green)"
						: "var(--terminal-red)";

				return (
					<div
						key={`${tone}-${String(row.price)}-${index}`}
						className="relative overflow-hidden rounded-md border border-[var(--terminal-border)] bg-[var(--terminal-bg)] px-3 py-2"
					>
						<div
							className="absolute inset-y-0 left-0 opacity-18"
							style={{ width, backgroundColor: color }}
						/>
						<div className="relative flex items-center justify-between text-sm">
							<span style={{ color }} className="font-semibold">
								{formatPrice(row.price)}
							</span>
							<span className="text-[var(--terminal-text-muted)]">
								{formatQty(row.qty)}
							</span>
						</div>
					</div>
				);
			})}
		</div>
	);
}

export function OrderBookPanel() {
	const { symbol } = useSymbolSelection();
	const { snapshot } = useOrderBook(symbol);
	const { lastBar } = useMarketData(symbol);
	const asks = snapshot?.asks ?? [];
	const bids = snapshot?.bids ?? [];

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] p-4">
			<div className="mb-4">
				<div className="text-sm font-semibold text-[var(--terminal-text)]">
					Order Book
				</div>
				<div className="text-xs text-[var(--terminal-text-muted)]">{symbol}</div>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-3">
				<div className="flex min-h-0 flex-1 flex-col">
					<div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--terminal-text-muted)]">
						Asks
					</div>
					<ScrollArea className="min-h-0 flex-1 rounded-lg border border-[var(--terminal-border)] bg-[var(--terminal-bg)] pr-3">
						<div className="p-3">
							<DepthRows rows={asks} tone="sell" />
						</div>
					</ScrollArea>
				</div>

				<div className="rounded-lg border border-[var(--terminal-border)] bg-[var(--terminal-bg)] px-3 py-3">
					<div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--terminal-text-muted)]">
						Spread
					</div>
					<div className="mt-2 flex items-baseline justify-between gap-2">
						<span className="text-lg font-semibold text-[var(--terminal-text)]">
							{formatPrice(snapshot?.lastPrice ?? lastBar?.close)}
						</span>
						<span className="text-sm text-[var(--terminal-text-muted)]">
							{formatPrice(snapshot?.spread)}
						</span>
					</div>
				</div>

				<div className="flex min-h-0 flex-1 flex-col">
					<div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--terminal-text-muted)]">
						Bids
					</div>
					<ScrollArea className="min-h-0 flex-1 rounded-lg border border-[var(--terminal-border)] bg-[var(--terminal-bg)] pr-3">
						<div className="p-3">
							<DepthRows rows={bids} tone="buy" />
						</div>
					</ScrollArea>
				</div>
			</div>

			<div className="mt-4">
				<MarketStats />
			</div>
		</section>
	);
}
