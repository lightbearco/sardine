import { WebSocket } from "ws";

export class ConnectionManager {
  private channels = new Map<string, Set<WebSocket>>();
  private sockets = new Map<WebSocket, Set<string>>();

  subscribe(ws: WebSocket, channel: string) {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(ws);

    if (!this.sockets.has(ws)) {
      this.sockets.set(ws, new Set());
    }
    this.sockets.get(ws)!.add(channel);
  }

  unsubscribe(ws: WebSocket, channel: string) {
    this.channels.get(channel)?.delete(ws);
    const socketChannels = this.sockets.get(ws);
    socketChannels?.delete(channel);
    
    // Cleanup if empty
    if (this.channels.get(channel)?.size === 0) {
      this.channels.delete(channel);
    }

    if (socketChannels?.size === 0) {
      this.sockets.delete(ws);
    }
  }

  getSubscribers(channel: string): Set<WebSocket> {
    return this.channels.get(channel) ?? new Set();
  }

  removeChannels(matcher: (channel: string) => boolean) {
    for (const [channel, subscribers] of Array.from(this.channels.entries())) {
      if (!matcher(channel)) {
        continue;
      }

      for (const ws of subscribers) {
        this.sockets.get(ws)?.delete(channel);
      }

      this.channels.delete(channel);
    }

    for (const [ws, channels] of Array.from(this.sockets.entries())) {
      if (channels.size === 0) {
        this.sockets.delete(ws);
      }
    }
  }

  removeConnection(ws: WebSocket) {
    const subscribedChannels = this.sockets.get(ws) ?? new Set();
    for (const channel of subscribedChannels) {
      const channelSet = this.channels.get(channel);
      if (channelSet) {
        channelSet.delete(ws);
        if (channelSet.size === 0) {
          this.channels.delete(channel);
        }
      }
    }
    this.sockets.delete(ws);
  }
}

export const connectionManager = new ConnectionManager();
