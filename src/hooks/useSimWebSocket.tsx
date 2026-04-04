import { createContext, useContext, useEffect, useState, useRef, useMemo } from "react";
import type { ReactNode } from "react";
import EventEmitter from "eventemitter3";

export interface WsMessageData {
  channel: string;
  data: unknown;
}

interface SimWebSocketContextValue {
  subscribe: <T>(channel: string, callback: (data: T) => void) => () => void;
  isConnected: boolean;
}

const SimWebSocketContext = createContext<SimWebSocketContextValue | null>(null);

export function SimWebSocketProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const eventEmitter = useRef(new EventEmitter());
  const activeChannels = useRef(new Set<string>());

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      // Connect to WebSocket server running alongside the app/worker
      const ws = new WebSocket("ws://localhost:3001");
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        // Resubscribe to active channels upon connection
        for (const channel of activeChannels.current) {
          ws.send(JSON.stringify({ type: "subscribe", channel }));
        }
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
        // Basic auto-reconnect
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

  const value = useMemo<SimWebSocketContextValue>(() => ({
    isConnected,
    subscribe: (channel: string, callback: (data: any) => void) => {
      eventEmitter.current.on(channel, callback);

      // Tell the server to subscribe if not already tracking this channel
      if (!activeChannels.current.has(channel)) {
        activeChannels.current.add(channel);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: "subscribe", channel }));
        }
      }

      return () => {
        eventEmitter.current.off(channel, callback);
        
        // If no more listeners for this channel, unsubscribe from server
        if (eventEmitter.current.listenerCount(channel) === 0) {
          activeChannels.current.delete(channel);
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "unsubscribe", channel }));
          }
        }
      };
    }
  }), [isConnected]);

  return (
    <SimWebSocketContext.Provider value={value}>
      {children}
    </SimWebSocketContext.Provider>
  );
}

export function useSimWebSocket() {
  const ctx = useContext(SimWebSocketContext);
  if (!ctx) {
    throw new Error("useSimWebSocket must be used within a SimWebSocketProvider");
  }
  return ctx;
}
