import {
	createContext,
	useCallback,
	useContext,
	useState,
	type ReactNode,
} from "react";

type MaximizedPanelContextValue = {
	maximizedId: string | null;
	toggleMaximize: (id: string) => void;
};

const MaximizedPanelContext = createContext<MaximizedPanelContextValue | null>(
	null,
);

export function MaximizedPanelProvider({ children }: { children: ReactNode }) {
	const [maximizedId, setMaximizedId] = useState<string | null>(null);

	const toggleMaximize = useCallback((id: string) => {
		setMaximizedId((prev) => (prev === id ? null : id));
	}, []);

	return (
		<MaximizedPanelContext.Provider value={{ maximizedId, toggleMaximize }}>
			{children}
		</MaximizedPanelContext.Provider>
	);
}

export function useMaximizedPanel() {
	const context = useContext(MaximizedPanelContext);
	if (!context) {
		throw new Error(
			"useMaximizedPanel must be used within a MaximizedPanelProvider",
		);
	}
	return context;
}
