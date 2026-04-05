import {
	createAlpacaClient,
	type AlpacaBarSnapshot,
	type AlpacaClient,
	type AlpacaQuoteSnapshot,
} from "#/alpaca/client";

const FALLBACK_SEED_PRICE = 150;
const FALLBACK_SPREAD = 0.1;

export interface BootstrapSymbolMarketData {
	symbol: string;
	bidPrice: number;
	askPrice: number;
	midPrice: number;
	lastPrice: number;
	spread: number;
	bars: AlpacaBarSnapshot[];
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
					},
				];
			}),
		),
	};
}

export async function loadBootstrapMarketData(
	symbols: string[],
	client: AlpacaClient = createAlpacaClient(),
): Promise<BootstrapMarketData> {
	const [quotes, bars] = await Promise.all([
		client.getLatestQuotes(symbols),
		client.getBars(symbols, "1Day", 60),
	]);

	return buildBootstrapMarketData({
		symbols,
		quotes,
		bars,
	});
}
