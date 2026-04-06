import { WebSocketServer, WebSocket } from "ws";
import { createLogger } from "#/lib/logger";
import { hasSimulationSession } from "#/server/sessions";
import { parseWsChannel } from "#/types/ws";
import { connectionManager } from "./ConnectionManager";

const log = createLogger("WsServer");

export async function validateWsSubscriptionChannel(channel: string): Promise<
	| {
			ok: true;
	  }
	| {
			ok: false;
			reason: "invalid_channel" | "unknown_session";
	  }
> {
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

export function startSimWebSocketServer(
	port: number = Number(process.env.WS_PORT) || 3001,
) {
	const verboseChannelLogs = process.env.SIM_WS_VERBOSE_LOGS === "1";
	const wss = new WebSocketServer({ port });

	wss.on("connection", (ws: WebSocket) => {
		log.info("WebSocket client connected");

		ws.on("message", async (msg) => {
			try {
				const messageStr = msg.toString();
				const parsed = JSON.parse(messageStr);

				if (parsed.type === "subscribe" && typeof parsed.channel === "string") {
					const validation = await validateWsSubscriptionChannel(
						parsed.channel,
					);
					if (!validation.ok) {
						if (verboseChannelLogs) {
							log.warn(
								{ channel: parsed.channel, reason: validation.reason },
								"rejected channel subscription",
							);
						}
						return;
					}
					connectionManager.subscribe(ws, parsed.channel);
					if (verboseChannelLogs) {
						log.info({ channel: parsed.channel }, "subscribed to channel");
					}
				} else if (
					parsed.type === "unsubscribe" &&
					typeof parsed.channel === "string"
				) {
					connectionManager.unsubscribe(ws, parsed.channel);
					if (verboseChannelLogs) {
						log.info({ channel: parsed.channel }, "unsubscribed from channel");
					}
				}
			} catch (err) {
				log.error({ err }, "failed to parse websocket message");
			}
		});

		ws.on("close", () => {
			connectionManager.removeConnection(ws);
			log.info("WebSocket client disconnected");
		});
	});

	log.info({ port }, "SimWebSocketServer running");
	return wss;
}
