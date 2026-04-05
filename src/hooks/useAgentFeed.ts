import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent } from "#/types/sim";
import { useSimWebSocket } from "./useSimWebSocket";
import { useSessionDashboard } from "./useSessionDashboard";

const raf =
	typeof requestAnimationFrame !== "undefined"
		? requestAnimationFrame
		: (cb: FrameRequestCallback) => setTimeout(cb, 16);
const caf =
	typeof cancelAnimationFrame !== "undefined"
		? cancelAnimationFrame
		: (handle: number) => clearTimeout(handle);

export function mergeAgentFeedEvents(
	previous: AgentEvent[],
	incoming: AgentEvent,
	maxEvents: number,
): AgentEvent[] {
	const deduped = previous.filter(
		(existing) => existing.eventId !== incoming.eventId,
	);
	return [incoming, ...deduped].slice(0, maxEvents);
}

export function useAgentFeed(maxEvents: number = 50) {
	const { subscribe, isConnected } = useSimWebSocket();
	const { isLive, sessionId, agentEvents: initialEvents } = useSessionDashboard();
	const [events, setEvents] = useState<AgentEvent[]>(
		initialEvents.slice(-maxEvents).reverse(),
	);
	const queueRef = useRef<AgentEvent[]>([]);
	const frameRef = useRef<number | null>(null);

	const flushQueue = useCallback(() => {
		frameRef.current = null;
		const incoming = queueRef.current.splice(0);
		if (incoming.length === 0) {
			return;
		}

		setEvents((previous) => {
			let next = previous;
			for (const event of incoming) {
				next = mergeAgentFeedEvents(next, event, maxEvents);
			}
			return next;
		});

		if (queueRef.current.length > 0) {
			frameRef.current = raf(flushQueue);
		}
	}, [maxEvents]);

	useEffect(() => {
		setEvents(initialEvents.slice(-maxEvents).reverse());
	}, [initialEvents, maxEvents]);

	useEffect(() => {
		if (!isLive) {
			return;
		}

		const unsubscribe = subscribe(`agents:${sessionId}`, (event: AgentEvent) => {
			queueRef.current.push(event);
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
	}, [flushQueue, isLive, sessionId, subscribe]);

	return { events, isConnected, isLive };
}
