import {
	createAlpacaClient,
	type AlpacaBarSnapshot,
	type AlpacaClient,
	type AlpacaDataType,
	type AlpacaMarketSnapshot,
	type AlpacaQuoteSnapshot,
	type AlpacaTradeSnapshot,
} from "#/alpaca/client";
import { createLogger } from "#/lib/logger";

const log = createLogger("Alpaca");

const FALLBACK_SEED_PRICE = 150;
const FALLBACK_SPREAD = 0.1;
const DEFAULT_DATA_TYPES: AlpacaDataType[] = ["snapshots"];

export interface BootstrapSymbolMarketData {
	symbol: string;
	bidPrice: number;
	askPrice: number;
	midPrice: number;
	lastPrice: number;
	spread: number;
	bars: AlpacaBarSnapshot[];
	trades: AlpacaTradeSnapshot[];
	snapshot: AlpacaMarketSnapshot | null;
}

export interface BootstrapMarketData {
	symbols: Record<string, BootstrapSymbolMarketData>;
}

function deriveSeedPrice(
	quote: AlpacaQuoteSnapshot,
	bars: AlpacaBarSnapshot[],
): number {
	return (
		quote.lastPrice ??
		quote.bidPrice ??
		quote.askPrice ??
		bars.at(-1)?.close ??
		FALLBACK_SEED_PRICE
	);
}

export function buildBootstrapMarketData(input: {
	symbols: string[];
	quotes: Map<string, AlpacaQuoteSnapshot>;
	bars: Map<string, AlpacaBarSnapshot[]>;
	trades?: Map<string, AlpacaTradeSnapshot[]>;
	snapshots?: Map<string, AlpacaMarketSnapshot>;
}): BootstrapMarketData {
	return {
		symbols: Object.fromEntries(
			input.symbols.map((symbol) => {
				const quote = input.quotes.get(symbol) ?? {
					symbol,
					bidPrice: null,
					askPrice: null,
					midPrice: null,
					lastPrice: null,
					spread: null,
					timestamp: null,
				};
				const history = input.bars.get(symbol) ?? [];
				const seedPrice = deriveSeedPrice(quote, history);
				const spread = quote.spread ?? FALLBACK_SPREAD;
				const halfSpread = spread / 2;
				const bidPrice =
					quote.bidPrice ?? Number((seedPrice - halfSpread).toFixed(4));
				const askPrice =
					quote.askPrice ?? Number((seedPrice + halfSpread).toFixed(4));
				const midPrice =
					quote.midPrice ?? Number(((bidPrice + askPrice) / 2).toFixed(4));
				const lastPrice = quote.lastPrice ?? history.at(-1)?.close ?? midPrice;

				return [
					symbol,
					{
						symbol,
						bidPrice,
						askPrice,
						midPrice,
						lastPrice,
						spread: Number((askPrice - bidPrice).toFixed(4)),
						bars: history,
						trades: input.trades?.get(symbol) ?? [],
						snapshot: input.snapshots?.get(symbol) ?? null,
					},
				];
			}),
		),
	};
}

export async function loadBootstrapMarketData(
	symbols: string[],
	client: AlpacaClient = createAlpacaClient(),
	dataTypes: AlpacaDataType[] = DEFAULT_DATA_TYPES,
): Promise<BootstrapMarketData> {
	const fetchQuotes = dataTypes.includes("quotes")
		? client.getLatestQuotes(symbols)
		: Promise.resolve(
				new Map(
					symbols.map((s) => [
						s,
						{
							symbol: s,
							bidPrice: null,
							askPrice: null,
							midPrice: null,
							lastPrice: null,
							spread: null,
							timestamp: null,
						} satisfies AlpacaQuoteSnapshot,
					]),
				),
			);

	const fetchBars = dataTypes.includes("bars")
		? client.getBars(symbols, "1Day", 60)
		: Promise.resolve(
				new Map(symbols.map((s) => [s, [] as AlpacaBarSnapshot[]])),
			);

	const fetchTrades = dataTypes.includes("trades")
		? client.getLatestTrades(symbols).then((m) => {
				const grouped = new Map<string, AlpacaTradeSnapshot[]>();
				for (const [sym, trade] of m) {
					grouped.set(sym, [trade]);
				}
				return grouped;
			})
		: Promise.resolve(new Map<string, AlpacaTradeSnapshot[]>());

	const fetchSnapshots = dataTypes.includes("snapshots")
		? client.getSnapshots(symbols)
		: Promise.resolve(new Map<string, AlpacaMarketSnapshot>());

	const [quotes, bars, trades, snapshots] = await Promise.all([
		fetchQuotes,
		fetchBars,
		fetchTrades,
		fetchSnapshots,
	]);

	if (!dataTypes.includes("quotes")) {
		for (const [symbol, snapshot] of snapshots) {
			const quote = snapshot?.dailyQuote;
			const hasValidQuote =
				quote !== null &&
				quote !== undefined &&
				(quote.midPrice !== null || quote.lastPrice !== null);

			if (hasValidQuote) {
				quotes.set(symbol, quote!);
			} else {
				log.warn(
					{
						symbol,
						quote: JSON.stringify(quote, null, 2),
						snapshotKeys: snapshot
							? {
									dailyQuote: snapshot.dailyQuote ? "present" : "null",
									dailyTrade: snapshot.dailyTrade
										? { price: snapshot.dailyTrade.price }
										: "null",
									dailyBar: snapshot.dailyBar
										? { close: snapshot.dailyBar.close }
										: "null",
									prevDailyBar: snapshot.prevDailyBar
										? { close: snapshot.prevDailyBar.close }
										: "null",
								}
							: "null",
					},
					`${symbol} dailyQuote missing or invalid`,
				);

				const alpacaPrice =
					snapshot?.dailyTrade?.price ??
					snapshot?.dailyBar?.close ??
					snapshot?.prevDailyBar?.close ??
					null;
				if (alpacaPrice !== null) {
					log.info({ symbol, price: alpacaPrice }, "using fallback price");
					const spread = FALLBACK_SPREAD;
					const halfSpread = spread / 2;
					quotes.set(symbol, {
						symbol,
						bidPrice: Number((alpacaPrice - halfSpread).toFixed(4)),
						askPrice: Number((alpacaPrice + halfSpread).toFixed(4)),
						midPrice: alpacaPrice,
						lastPrice: alpacaPrice,
						spread,
						timestamp:
							snapshot?.dailyBar?.timestamp ??
							snapshot?.dailyTrade?.timestamp ??
							null,
					});
				} else {
					log.error(
						{ symbol, fallbackSeedPrice: FALLBACK_SEED_PRICE },
						"no price data found in snapshot; falling back to default seed price",
					);
				}
			}
		}
	}

	return buildBootstrapMarketData({
		symbols,
		quotes,
		bars,
		trades,
		snapshots,
	});
}

export { DEFAULT_DATA_TYPES };
