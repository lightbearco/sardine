import Decimal from "decimal.js";
import type { OHLCVBar, Trade } from "#/types/market";

export function computeOhlcvBars(trades: Trade[]): OHLCVBar[] {
	const bars = new Map<string, OHLCVBar>();

	for (const trade of trades) {
		const existingBar = bars.get(trade.symbol);

		if (!existingBar) {
			bars.set(trade.symbol, {
				symbol: trade.symbol,
				open: trade.price,
				high: trade.price,
				low: trade.price,
				close: trade.price,
				volume: trade.qty,
				tick: trade.tick,
			});
			continue;
		}

		existingBar.high = Decimal.max(existingBar.high, trade.price);
		existingBar.low = Decimal.min(existingBar.low, trade.price);
		existingBar.close = trade.price;
		existingBar.volume += trade.qty;
	}

	return Array.from(bars.values());
}
