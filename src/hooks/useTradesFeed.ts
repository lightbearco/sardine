import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TradeData } from "#/types/market";
import { useSessionDashboard } from "./useSessionDashboard";
import { useSimWebSocket } from "./useSimWebSocket";

const raf =
	typeof requestAnimationFrame !== "undefined"
		? requestAnimationFrame
		: (cb: FrameRequestCallback) => setTimeout(cb, 16);
const caf =
	typeof cancelAnimationFrame !== "undefined"
		? cancelAnimationFrame
		: (handle: number) => clearTimeout(handle);

export function useTradesFeed(symbol: string) {
	const { subscribe, isConnected } = useSimWebSocket();
	const {
		sessionId,
		isLive,
		symbol: selectedSymbol,
		trades: initialTrades,
	} = useSessionDashboard();
	const hydratedTrades = useMemo(
		() => (symbol === selectedSymbol ? initialTrades : []),
		[initialTrades, selectedSymbol, symbol],
	);
	const [trades, setTrades] = useState<TradeData[]>(hydratedTrades);
	const queueRef = useRef<TradeData[][]>([]);
	const frameRef = useRef<number | null>(null);

	const flushQueue = useCallback(() => {
		frameRef.current = null;
		const incoming = queueRef.current.splice(0);
		if (incoming.length === 0) {
			return;
		}

		setTrades((previous) => {
			let next = previous;
			for (const batch of incoming) {
				next = [...batch, ...next].slice(0, 100);
			}
			return next;
		});

		if (queueRef.current.length > 0) {
			frameRef.current = raf(flushQueue);
		}
	}, []);

	useEffect(() => {
		if (!symbol) {
			setTrades([]);
			return;
		}

		setTrades(hydratedTrades);

		if (!isLive) {
			return;
		}

		const unsubscribe = subscribe(`trades:${sessionId}:${symbol}`, (nextTrades: TradeData[]) => {
			queueRef.current.push(nextTrades);
			if (frameRef.current === null) {
				frameRef.current = raf(flushQueue);
			}
		});

		return () => {
			unsubscribe();
			if (frameRef.current !== null) {
				caf(frameRef.current);
				frameRef.current = null;
			}
			queueRef.current.splice(0);
		};
	}, [flushQueue, hydratedTrades, isLive, sessionId, symbol, subscribe]);

	return { trades, isConnected };
}
