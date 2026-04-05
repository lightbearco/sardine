import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	hasSimulationSession: vi.fn(),
}));

vi.mock("#/server/sessions", () => ({
	hasSimulationSession: mocks.hasSimulationSession,
}));

import { validateWsSubscriptionChannel } from "../SimWebSocketServer";

describe("validateWsSubscriptionChannel", () => {
	it("rejects malformed channels", async () => {
		const result = await validateWsSubscriptionChannel("bad-channel");
		expect(result).toEqual({ ok: false, reason: "invalid_channel" });
		expect(mocks.hasSimulationSession).not.toHaveBeenCalled();
	});

	it("rejects unknown sessions", async () => {
		mocks.hasSimulationSession.mockResolvedValueOnce(false);

		const result = await validateWsSubscriptionChannel("agents:sim-missing");
		expect(result).toEqual({ ok: false, reason: "unknown_session" });
	});

	it("accepts known session channels", async () => {
		mocks.hasSimulationSession.mockResolvedValueOnce(true);

		const result = await validateWsSubscriptionChannel("ohlcv:sim-123:AAPL");
		expect(result).toEqual({ ok: true });
	});
});
