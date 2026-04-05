import { WebSocketServer, WebSocket } from "ws";
import { hasSimulationSession } from "#/server/sessions";
import { parseWsChannel } from "#/types/ws";
import { connectionManager } from "./ConnectionManager";

export async function validateWsSubscriptionChannel(channel: string): Promise<{
	ok: true;
} | {
	ok: false;
	reason: "invalid_channel" | "unknown_session";
}> {
	const parsed = parseWsChannel(channel);
	if (!parsed) {
		return { ok: false, reason: "invalid_channel" };
	}

	if (parsed.kind === "world_events") {
		return { ok: true };
	}

	const exists = await hasSimulationSession(parsed.sessionId);
	return exists ? { ok: true } : { ok: false, reason: "unknown_session" };
}

export function startSimWebSocketServer(port: number = Number(process.env.WS_PORT) || 3001) {
  const verboseChannelLogs = process.env.SIM_WS_VERBOSE_LOGS === "1";
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
    console.log("WebSocket client connected");

    ws.on("message", async (msg) => {
      try {
        const messageStr = msg.toString();
        const parsed = JSON.parse(messageStr);
        
        if (parsed.type === "subscribe" && typeof parsed.channel === "string") {
          const validation = await validateWsSubscriptionChannel(parsed.channel);
          if (!validation.ok) {
            if (verboseChannelLogs) {
              console.warn(`Rejected channel subscription: ${parsed.channel} (${validation.reason})`);
            }
            return;
          }
          connectionManager.subscribe(ws, parsed.channel);
          if (verboseChannelLogs) {
            console.log(`Subscribed to channel: ${parsed.channel}`);
          }
        } else if (parsed.type === "unsubscribe" && typeof parsed.channel === "string") {
          connectionManager.unsubscribe(ws, parsed.channel);
          if (verboseChannelLogs) {
            console.log(`Unsubscribed from channel: ${parsed.channel}`);
          }
        }
      } catch (err) {
        console.error("Failed to parse websocket message:", err);
      }
    });

    ws.on("close", () => {
      connectionManager.removeConnection(ws);
      console.log("WebSocket client disconnected");
    });
  });

  console.log(`SimWebSocketServer running on port ${port}`);
  return wss;
}
