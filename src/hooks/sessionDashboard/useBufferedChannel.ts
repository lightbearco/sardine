import { useCallback, useEffect, useRef, useState } from "react";
import type { WsChannel } from "#/types/ws";
import type { useSimWebSocket } from "../useSimWebSocket";

const raf =
	typeof requestAnimationFrame !== "undefined"
		? requestAnimationFrame
		: (cb: FrameRequestCallback) => setTimeout(cb, 16);
const caf =
	typeof cancelAnimationFrame !== "undefined"
		? cancelAnimationFrame
		: (handle: number) => clearTimeout(handle);

type SubscribeFn = ReturnType<typeof useSimWebSocket>["subscribe"];

export function useBufferedChannel<TMessage, TState>({
	channel,
	subscribe,
	reducer,
	initialState,
	guard,
	resetKey,
}: {
	channel: WsChannel | null;
	subscribe: SubscribeFn;
	reducer: (state: TState, messages: TMessage[]) => TState;
	initialState: TState;
	guard?: boolean;
	resetKey?: unknown;
}): TState {
	const [state, setState] = useState<TState>(initialState);
	const queueRef = useRef<TMessage[]>([]);
	const frameRef = useRef<number | null>(null);
	const prevResetKeyRef = useRef<unknown>(resetKey);

	if (resetKey !== prevResetKeyRef.current) {
		prevResetKeyRef.current = resetKey;
		setState(initialState);
	}

	const flush = useCallback(() => {
		frameRef.current = null;
		const incoming = queueRef.current.splice(0);
		if (incoming.length === 0) {
			return;
		}

		setState((previous) => reducer(previous, incoming));

		if (queueRef.current.length > 0) {
			frameRef.current = raf(flush);
		}
	}, [reducer]);

	useEffect(() => {
		if (guard === false || channel === null) {
			return;
		}

		const unsubscribe = subscribe(channel, (msg: TMessage) => {
			queueRef.current.push(msg);
			if (frameRef.current === null) {
				frameRef.current = raf(flush);
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
	}, [channel, flush, guard, subscribe]);

	return state;
}
