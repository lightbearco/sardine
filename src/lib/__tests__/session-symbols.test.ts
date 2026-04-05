import { describe, expect, it } from "vitest";
import {
	isSupportedSessionSymbol,
	normalizeSessionSymbol,
	shouldReplaceSessionSymbolInUrl,
} from "../session-symbols";

describe("session symbol helpers", () => {
	it("preserves valid requested symbols", () => {
		expect(normalizeSessionSymbol("NVDA", ["AAPL", "NVDA"])).toBe("NVDA");
	});

	it("falls back to the first supported symbol for missing or invalid values", () => {
		expect(normalizeSessionSymbol(undefined, ["AAPL", "NVDA"])).toBe("AAPL");
		expect(normalizeSessionSymbol("TSLA", ["AAPL", "NVDA"])).toBe("AAPL");
	});

	it("only rewrites the URL for missing or invalid symbols", () => {
		expect(
			shouldReplaceSessionSymbolInUrl({
				requestedSymbol: undefined,
				resolvedSymbol: "AAPL",
				supportedSymbols: ["AAPL", "NVDA"],
			}),
		).toBe(true);

		expect(
			shouldReplaceSessionSymbolInUrl({
				requestedSymbol: "TSLA",
				resolvedSymbol: "AAPL",
				supportedSymbols: ["AAPL", "NVDA"],
			}),
		).toBe(true);

		expect(
			shouldReplaceSessionSymbolInUrl({
				requestedSymbol: "NVDA",
				resolvedSymbol: "AAPL",
				supportedSymbols: ["AAPL", "NVDA"],
			}),
		).toBe(false);
	});

	it("detects whether a requested symbol is supported by the session", () => {
		expect(isSupportedSessionSymbol("NVDA", ["AAPL", "NVDA"])).toBe(true);
		expect(isSupportedSessionSymbol("TSLA", ["AAPL", "NVDA"])).toBe(false);
		expect(isSupportedSessionSymbol(undefined, ["AAPL", "NVDA"])).toBe(false);
	});
});
