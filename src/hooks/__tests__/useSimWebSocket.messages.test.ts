import { describe, expect, it, vi } from "vitest";
import {
	buildSubscribeMessage,
	buildUnsubscribeMessage,
	resubscribeActiveChannels,
} from "../useSimWebSocket";

describe("useSimWebSocket helpers", () => {
	it("builds subscribe and unsubscribe messages with typed channels", () => {
		expect(buildSubscribeMessage("agents:sim-123")).toEqual({
			type: "subscribe",
			channel: "agents:sim-123",
		});
		expect(buildUnsubscribeMessage("sim:sim-123")).toEqual({
			type: "unsubscribe",
			channel: "sim:sim-123",
		});
	});

	it("resubscribes every active channel after reconnect", () => {
		const send = vi.fn();
		resubscribeActiveChannels(
			["agents:sim-123", "ohlcv:sim-123:AAPL"],
			send,
		);

		expect(send).toHaveBeenCalledTimes(2);
		expect(send).toHaveBeenNthCalledWith(
			1,
			JSON.stringify({
				type: "subscribe",
				channel: "agents:sim-123",
			}),
		);
		expect(send).toHaveBeenNthCalledWith(
			2,
			JSON.stringify({
				type: "subscribe",
				channel: "ohlcv:sim-123:AAPL",
			}),
		);
	});
});
