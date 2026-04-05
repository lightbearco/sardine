import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface SymbolSelectionContextValue {
	symbol: string;
	setSymbol: (symbol: string) => void;
}

const SymbolSelectionContext = createContext<SymbolSelectionContextValue | null>(
	null,
);

export function SymbolSelectionProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [symbol, setSymbol] = useState("AAPL");
	const value = useMemo(() => ({ symbol, setSymbol }), [symbol]);

	return (
		<SymbolSelectionContext.Provider value={value}>
			{children}
		</SymbolSelectionContext.Provider>
	);
}

export function useSymbolSelection() {
	const context = useContext(SymbolSelectionContext);

	if (!context) {
		throw new Error(
			"useSymbolSelection must be used within a SymbolSelectionProvider",
		);
	}

	return context;
}
