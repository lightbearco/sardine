import { useMarketData } from "#/hooks/useMarketData";
import { useOrderBook } from "#/hooks/useOrderBook";
import { useSymbolSelection } from "#/hooks/useSymbolSelection";

function formatPrice(value: unknown) {
	if (value === null || value === undefined) {
		return "—";
	}

	const parsed = Number(value);
	return Number.isNaN(parsed)
		? "—"
		: new Intl.NumberFormat("en-US", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(parsed);
}

function stat(label: string, value: string) {
	return (
		<div className="rounded-md border border-[var(--terminal-border)] bg-[var(--terminal-bg)] px-3 py-2">
			<div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--terminal-text-muted)]">
				{label}
			</div>
			<div className="mt-1 text-sm font-semibold text-[var(--terminal-text)]">
				{value}
			</div>
		</div>
	);
}

export function MarketStats() {
	const { symbol } = useSymbolSelection();
	const { snapshot } = useOrderBook(symbol);
	const { lastBar } = useMarketData(symbol);

	return (
		<div className="grid grid-cols-2 gap-2">
			{stat("Spread", formatPrice(snapshot?.spread))}
			{stat("Last", formatPrice(snapshot?.lastPrice ?? lastBar?.close))}
			{stat("Volume", String(lastBar?.volume ?? 0))}
			{stat("Tick", String(lastBar?.tick ?? 0))}
		</div>
	);
}
