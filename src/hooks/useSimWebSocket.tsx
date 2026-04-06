import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ReactNode } from "react";
import EventEmitter from "eventemitter3";
import {
	WsMessageType,
	type WsChannel,
	type WsClientMessage,
} from "#/types/ws";

export interface WsMessageData {
	channel: string;
	data: unknown;
}

interface SimWebSocketContextValue {
	subscribe: <T>(channel: WsChannel, callback: (data: T) => void) => () => void;
	isConnected: boolean;
	reconnectCount: number;
}

const SimWebSocketContext = createContext<SimWebSocketContextValue | null>(
	null,
);

export function buildSubscribeMessage(channel: WsChannel): WsClientMessage {
	return {
		type: WsMessageType.Subscribe,
		channel,
	};
}

export function buildUnsubscribeMessage(channel: WsChannel): WsClientMessage {
	return {
		type: WsMessageType.Unsubscribe,
		channel,
	};
}

export function resubscribeActiveChannels(
	channels: Iterable<WsChannel>,
	send: (serializedMessage: string) => void,
) {
	for (const channel of channels) {
		send(JSON.stringify(buildSubscribeMessage(channel)));
	}
}

export function SimWebSocketProvider({ children }: { children: ReactNode }) {
	const [isConnected, setIsConnected] = useState(false);
	const [reconnectCount, setReconnectCount] = useState(0);
	const wsRef = useRef<WebSocket | null>(null);
	const eventEmitter = useRef(new EventEmitter());
	const activeChannels = useRef(new Set<WsChannel>());
	const hasConnectedOnce = useRef(false);

	useEffect(() => {
		let reconnectTimer: ReturnType<typeof setTimeout>;

		function connect() {
			const ws = new WebSocket("ws://localhost:3001");
			wsRef.current = ws;

			ws.onopen = () => {
				setIsConnected(true);
				if (hasConnectedOnce.current) {
					setReconnectCount((prev) => prev + 1);
				}
				hasConnectedOnce.current = true;
				resubscribeActiveChannels(activeChannels.current, (message) => {
					ws.send(message);
				});
			};

			ws.onmessage = (event) => {
				try {
					const message: WsMessageData = JSON.parse(event.data);
					eventEmitter.current.emit(message.channel, message.data);
				} catch (err) {
					console.error("Failed to parse WS message", err);
				}
			};

			ws.onclose = () => {
				setIsConnected(false);
				wsRef.current = null;
				reconnectTimer = setTimeout(connect, 3000);
			};

			ws.onerror = (err) => {
				console.error("WS error:", err);
			};
		}

		connect();

		return () => {
			clearTimeout(reconnectTimer);
			if (wsRef.current) {
				wsRef.current.close();
			}
		};
	}, []);

	const subscribe = useCallback<SimWebSocketContextValue["subscribe"]>(
		(channel, callback) => {
			eventEmitter.current.on(channel, callback);

			if (!activeChannels.current.has(channel)) {
				activeChannels.current.add(channel);
				if (wsRef.current?.readyState === WebSocket.OPEN) {
					wsRef.current.send(JSON.stringify(buildSubscribeMessage(channel)));
				}
			}

			return () => {
				eventEmitter.current.off(channel, callback);

				if (eventEmitter.current.listenerCount(channel) === 0) {
					activeChannels.current.delete(channel);
					if (wsRef.current?.readyState === WebSocket.OPEN) {
						wsRef.current.send(
							JSON.stringify(buildUnsubscribeMessage(channel)),
						);
					}
				}
			};
		},
		[],
	);

	const value = useMemo<SimWebSocketContextValue>(
		() => ({
			isConnected,
			reconnectCount,
			subscribe,
		}),
		[isConnected, reconnectCount, subscribe],
	);

	return (
		<SimWebSocketContext.Provider value={value}>
			{children}
		</SimWebSocketContext.Provider>
	);
}

export function useSimWebSocket() {
	const ctx = useContext(SimWebSocketContext);
	if (!ctx) {
		throw new Error(
			"useSimWebSocket must be used within a SimWebSocketProvider",
		);
	}
	return ctx;
}
