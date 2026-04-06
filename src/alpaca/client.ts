import Alpaca from "@alpacahq/alpaca-trade-api";
import type {
	AlpacaBar,
	AlpacaQuote,
	AlpacaSnapshot,
	AlpacaTrade,
} from "@alpacahq/alpaca-trade-api/dist/resources/datav2/entityv2";
import { getAlpacaEnv, hasAlpacaEnv, type AlpacaEnv } from "#/env";

export type AlpacaBarTimeframe = "1Day" | "1Hour" | "15Min" | "5Min" | "1Min";

export type AlpacaDataType = "quotes" | "bars" | "trades" | "snapshots";

const ALPACA_STOCK_DATA_URL = "https://data.alpaca.markets";

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

export interface AlpacaTradeSnapshot {
	symbol: string;
	price: number;
	size: number;
	timestamp: string;
	exchange: string;
	conditions: string[];
}

export interface AlpacaMarketSnapshot {
	symbol: string;
	dailyBar: AlpacaBarSnapshot | null;
	dailyTrade: AlpacaTradeSnapshot | null;
	dailyQuote: AlpacaQuoteSnapshot | null;
	prevDailyBar: AlpacaBarSnapshot | null;
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
	getLatestTrades(symbols: string[]): Promise<Map<string, AlpacaTradeSnapshot>>;
	getSnapshots(symbols: string[]): Promise<Map<string, AlpacaMarketSnapshot>>;
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

type RawBar = {
	t: string;
	o: number;
	h: number;
	l: number;
	c: number;
	v: number;
};
type RawTrade = { t: string; p: number; s: number; x: string; c?: string[] };
type RawQuote = {
	t: string;
	bp?: number;
	bs?: number;
	ap?: number;
	as?: number;
};
type RawSnapshot = {
	dailyBar?: RawBar;
	latestTrade?: RawTrade;
	latestQuote?: RawQuote;
	prevDailyBar?: RawBar;
};

function normalizeQuote(
	symbol: string,
	quote: AlpacaQuote | RawQuote | undefined,
): AlpacaQuoteSnapshot {
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

	const raw = quote as Record<string, unknown>;
	const bidRaw = raw.BidPrice ?? raw.bp;
	const askRaw = raw.AskPrice ?? raw.ap;
	const bidPrice =
		typeof bidRaw === "number" && Number.isFinite(bidRaw) ? bidRaw : null;
	const askPrice =
		typeof askRaw === "number" && Number.isFinite(askRaw) ? askRaw : null;
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
		timestamp: ((raw.Timestamp ?? raw.t) as string | undefined) ?? null,
	};
}

function normalizeBar(
	bar: AlpacaBar | RawBar,
	symbol?: string,
): AlpacaBarSnapshot {
	const raw = bar as Record<string, unknown>;
	return {
		symbol: (raw.Symbol ?? symbol ?? "") as string,
		open: (raw.OpenPrice ?? raw.o) as number,
		high: (raw.HighPrice ?? raw.h) as number,
		low: (raw.LowPrice ?? raw.l) as number,
		close: (raw.ClosePrice ?? raw.c) as number,
		volume: (raw.Volume ?? raw.v) as number,
		timestamp: (raw.Timestamp ?? raw.t) as string,
	};
}

function normalizeTrade(
	trade: AlpacaTrade | RawTrade,
	symbol?: string,
): AlpacaTradeSnapshot {
	const raw = trade as Record<string, unknown>;
	return {
		symbol: (raw.Symbol ?? symbol ?? "") as string,
		price: (raw.Price ?? raw.p) as number,
		size: (raw.Size ?? raw.s) as number,
		timestamp: (raw.Timestamp ?? raw.t) as string,
		exchange: (raw.Exchange ?? raw.x ?? "") as string,
		conditions: (raw.Conditions ?? raw.c ?? []) as string[],
	};
}

function normalizeSnapshot(
	symbol: string,
	snapshot: AlpacaSnapshot | RawSnapshot | undefined,
): AlpacaMarketSnapshot {
	if (!snapshot) {
		return {
			symbol,
			dailyBar: null,
			dailyTrade: null,
			dailyQuote: null,
			prevDailyBar: null,
		};
	}

	const raw = snapshot as Record<string, unknown>;
	const dailyBar = raw.DailyBar ?? raw.dailyBar;
	const latestTrade = raw.LatestTrade ?? raw.latestTrade;
	const latestQuote = raw.LatestQuote ?? raw.latestQuote;
	const prevDailyBar = raw.PrevDailyBar ?? raw.prevDailyBar;

	return {
		symbol,
		dailyBar: dailyBar ? normalizeBar(dailyBar as AlpacaBar, symbol) : null,
		dailyTrade: latestTrade
			? normalizeTrade(latestTrade as AlpacaTrade, symbol)
			: null,
		dailyQuote: latestQuote
			? normalizeQuote(symbol, latestQuote as AlpacaQuote)
			: null,
		prevDailyBar: prevDailyBar
			? normalizeBar(prevDailyBar as AlpacaBar, symbol)
			: null,
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
		const body = (await response.json().catch(() => null)) as {
			message?: string;
		} | null;
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
					feed: "iex",
				},
			});
			const quoteMap = new Map(Object.entries(response.quotes ?? {}));
			return new Map(
				symbols.map((symbol) => [
					symbol,
					normalizeQuote(symbol, quoteMap.get(symbol)),
				]),
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
				feed: "iex",
			});

			return new Map(
				symbols.map((symbol) => [
					symbol,
					(bars.get(symbol) ?? [])
						.map((bar) => normalizeBar(bar))
						.slice(-limit),
				]),
			);
		},

		async getLatestTrades(symbols) {
			const response = await dataRequest<{
				trades?: Record<string, AlpacaTrade>;
			}>({
				env,
				path: "/v2/stocks/trades/latest",
				query: {
					symbols: symbols.join(","),
					feed: "iex",
				},
			});
			const tradeMap = new Map(Object.entries(response.trades ?? {}));
			return new Map(
				symbols.map((symbol) => [
					symbol,
					normalizeTrade(
						tradeMap.get(symbol) ?? {
							Symbol: symbol,
							Price: 0,
							Size: 0,
							Timestamp: "",
							Exchange: "",
							Conditions: [],
							ID: 0,
							Tape: "",
						},
						symbol,
					),
				]),
			);
		},

		async getSnapshots(symbols) {
			const response = await dataRequest<{
				snapshots?: Record<string, AlpacaSnapshot>;
			}>({
				env,
				path: "/v2/stocks/snapshots",
				query: {
					symbols: symbols.join(","),
					feed: "iex",
				},
			});
			const snapshotMap = new Map(Object.entries(response.snapshots ?? {}));
			return new Map(
				symbols.map((symbol) => [
					symbol,
					normalizeSnapshot(symbol, snapshotMap.get(symbol)),
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
				...(order.type === "limit" ? { limit_price: order.limitPrice } : {}),
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
						? (order.limitPrice ?? null)
						: Number(result.limit_price),
			};
		},
	};
}

export { hasAlpacaEnv };
