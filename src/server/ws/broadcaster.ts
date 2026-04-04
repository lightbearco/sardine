import { WebSocket } from "ws";
import { connectionManager } from "./ConnectionManager";

export const broadcaster = {
  broadcast: (channel: string, data: unknown) => {
    const subscribers = connectionManager.getSubscribers(channel);
    if (subscribers.size === 0) {
      return;
    }
    
    // Convert any BigInt or other objects that don't directly serialize to JSON if necessary.
    // Assuming standard objects for now as requested.
    const message = JSON.stringify({ channel, data });
    for (const ws of subscribers) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }
};
