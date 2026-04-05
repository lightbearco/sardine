import { DEV_TICKERS } from "#/lib/constants";

const DEFAULT_SESSION_SYMBOL = DEV_TICKERS[0]?.symbol ?? "AAPL";

export function getSupportedSessionSymbols(
	supportedSymbols: string[] | null | undefined,
): string[] {
	return supportedSymbols && supportedSymbols.length > 0
		? supportedSymbols
		: DEV_TICKERS.map((ticker) => ticker.symbol);
}

export function normalizeSessionSymbol(
	requestedSymbol: string | undefined,
	supportedSymbols: string[] | null | undefined,
): string {
	const fallbackSymbols = getSupportedSessionSymbols(supportedSymbols);

	if (requestedSymbol && fallbackSymbols.includes(requestedSymbol)) {
		return requestedSymbol;
	}

	return fallbackSymbols[0] ?? DEFAULT_SESSION_SYMBOL;
}

export function isSupportedSessionSymbol(
	requestedSymbol: string | undefined,
	supportedSymbols: string[] | null | undefined,
): requestedSymbol is string {
	return (
		typeof requestedSymbol === "string"
		&& getSupportedSessionSymbols(supportedSymbols).includes(requestedSymbol)
	);
}

export function shouldReplaceSessionSymbolInUrl(input: {
	requestedSymbol: string | undefined;
	resolvedSymbol: string;
	supportedSymbols: string[] | null | undefined;
}): boolean {
	const { requestedSymbol, resolvedSymbol, supportedSymbols } = input;

	if (!requestedSymbol) {
		return true;
	}

	return !getSupportedSessionSymbols(supportedSymbols).includes(requestedSymbol)
		&& requestedSymbol !== resolvedSymbol;
}
