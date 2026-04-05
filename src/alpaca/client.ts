import Alpaca from "@alpacahq/alpaca-trade-api";
import type {
	AlpacaBar,
	AlpacaQuote,
} from "@alpacahq/alpaca-trade-api/dist/resources/datav2/entityv2";
import {
	getAlpacaEnv,
	hasAlpacaEnv,
	type AlpacaEnv,
} from "#/env";

export type AlpacaBarTimeframe = "1Day";

const ALPACA_STOCK_DATA_URL = "https://data.alpaca.markets";
const ALPACA_FREE_STOCK_FEED = "iex";

export interface AlpacaQuoteSnapshot {
	symbol: string;
	bidPrice: number | null;
	askPrice: number | null;
	midPrice: number | null;
	lastPrice: number | null;
	spread: number | null;
	timestamp: string | null;
}

export interface AlpacaBarSnapshot {
	symbol: string;
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
	timestamp: string;
}

export interface AlpacaOrderInput {
	symbol: string;
	side: "buy" | "sell";
	type: "market" | "limit";
	qty: number;
	limitPrice?: number;
	clientOrderId?: string;
}

export interface AlpacaOrderResult {
	id: string;
	clientOrderId: string | null;
	status: string;
	symbol: string;
	side: "buy" | "sell";
	type: "market" | "limit";
	qty: number | null;
	limitPrice: number | null;
}

export interface AlpacaClient {
	getLatestQuotes(symbols: string[]): Promise<Map<string, AlpacaQuoteSnapshot>>;
	getBars(
		symbols: string[],
		timeframe: AlpacaBarTimeframe,
		limit: number,
	): Promise<Map<string, AlpacaBarSnapshot[]>>;
	submitOrder(order: AlpacaOrderInput): Promise<AlpacaOrderResult>;
}

type AlpacaSdkLike = {
	timeframeUnit: {
		DAY: unknown;
	};
	newTimeframe(amount: number, unit: unknown): string;
	getMultiBarsV2(
		symbols: string[],
		options: Record<string, unknown>,
	): Promise<Map<string, AlpacaBar[]>>;
	createOrder(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

function resolveMidPrice(input: {
	bidPrice: number | null;
	askPrice: number | null;
}): number | null {
	const { bidPrice, askPrice } = input;

	if (bidPrice !== null && askPrice !== null) {
		return Number(((bidPrice + askPrice) / 2).toFixed(4));
	}

	return bidPrice ?? askPrice ?? null;
}

function normalizeQuote(symbol: string, quote: AlpacaQuote | undefined): AlpacaQuoteSnapshot {
	if (!quote) {
		return {
			symbol,
			bidPrice: null,
			askPrice: null,
			midPrice: null,
			lastPrice: null,
			spread: null,
			timestamp: null,
		};
	}

	const bidPrice = Number.isFinite(quote.BidPrice) ? quote.BidPrice : null;
	const askPrice = Number.isFinite(quote.AskPrice) ? quote.AskPrice : null;
	const midPrice = resolveMidPrice({ bidPrice, askPrice });
	const spread =
		bidPrice !== null && askPrice !== null
			? Number((askPrice - bidPrice).toFixed(4))
			: null;

	return {
		symbol,
		bidPrice,
		askPrice,
		midPrice,
		lastPrice: midPrice,
		spread,
		timestamp: quote.Timestamp ?? null,
	};
}

function normalizeBar(bar: AlpacaBar): AlpacaBarSnapshot {
	return {
		symbol: bar.Symbol,
		open: bar.OpenPrice,
		high: bar.HighPrice,
		low: bar.LowPrice,
		close: bar.ClosePrice,
		volume: bar.Volume,
		timestamp: bar.Timestamp,
	};
}

async function dataRequest<TResponse>(input: {
	env: AlpacaEnv;
	path: string;
	query: Record<string, string>;
}): Promise<TResponse> {
	const url = new URL(input.path, ALPACA_STOCK_DATA_URL);
	for (const [key, value] of Object.entries(input.query)) {
		url.searchParams.set(key, value);
	}

	const response = await fetch(url, {
		headers: {
			"APCA-API-KEY-ID": input.env.ALPACA_API_KEY,
			"APCA-API-SECRET-KEY": input.env.ALPACA_API_SECRET,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as
			| { message?: string }
			| null;
		throw new Error(
			`code: ${response.status}, message: ${body?.message ?? response.statusText}`,
		);
	}

	return (await response.json()) as TResponse;
}

function createSdk(env: AlpacaEnv): AlpacaSdkLike {
	return new Alpaca({
		keyId: env.ALPACA_API_KEY,
		secretKey: env.ALPACA_API_SECRET,
		paper: env.ALPACA_BASE_URL.includes("paper"),
		baseUrl: env.ALPACA_BASE_URL,
		feed: ALPACA_FREE_STOCK_FEED,
	}) as unknown as AlpacaSdkLike;
}

export function createAlpacaClient(
	input: NodeJS.ProcessEnv = process.env,
	sdkFactory: (env: AlpacaEnv) => AlpacaSdkLike = createSdk,
): AlpacaClient {
	const env = getAlpacaEnv(input);
	const sdk = sdkFactory(env);

	return {
		async getLatestQuotes(symbols) {
			const response = await dataRequest<{
				quotes?: Record<string, AlpacaQuote>;
			}>({
				env,
				path: "/v2/stocks/quotes/latest",
				query: {
					symbols: symbols.join(","),
					feed: ALPACA_FREE_STOCK_FEED,
				},
			});
			const quoteMap = new Map(Object.entries(response.quotes ?? {}));
			return new Map(
				symbols.map((symbol) => [symbol, normalizeQuote(symbol, quoteMap.get(symbol))]),
			);
		},

		async getBars(symbols, timeframe, limit) {
			if (timeframe !== "1Day") {
				throw new Error(`Unsupported Alpaca timeframe: ${timeframe}`);
			}

			const end = new Date();
			const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
			const bars = await sdk.getMultiBarsV2(symbols, {
				timeframe: sdk.newTimeframe(1, sdk.timeframeUnit.DAY),
				start: start.toISOString(),
				end: end.toISOString(),
				limit,
				feed: ALPACA_FREE_STOCK_FEED,
			});

			return new Map(
				symbols.map((symbol) => [
					symbol,
					(bars.get(symbol) ?? []).map(normalizeBar).slice(-limit),
				]),
			);
		},

		async submitOrder(order) {
			const result = await sdk.createOrder({
				symbol: order.symbol,
				qty: order.qty,
				side: order.side,
				type: order.type,
				time_in_force: "day",
				...(order.type === "limit"
					? { limit_price: order.limitPrice }
					: {}),
				...(order.clientOrderId
					? { client_order_id: order.clientOrderId }
					: {}),
			});

			return {
				id: String(result.id ?? ""),
				clientOrderId:
					typeof result.client_order_id === "string"
						? result.client_order_id
						: null,
				status: String(result.status ?? "accepted"),
				symbol: String(result.symbol ?? order.symbol),
				side: (result.side ?? order.side) as "buy" | "sell",
				type: (result.type ?? order.type) as "market" | "limit",
				qty:
					result.qty === undefined || result.qty === null
						? order.qty
						: Number(result.qty),
				limitPrice:
					result.limit_price === undefined || result.limit_price === null
						? order.limitPrice ?? null
						: Number(result.limit_price),
			};
		},
	};
}

export { hasAlpacaEnv };
