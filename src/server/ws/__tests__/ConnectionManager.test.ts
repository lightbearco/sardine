import { describe, expect, it } from "vitest";
import { ConnectionManager } from "../ConnectionManager";

describe("ConnectionManager", () => {
	it("removes empty socket state when the last listener unsubscribes", () => {
		const manager = new ConnectionManager();
		const socket = {} as never;

		manager.subscribe(socket, "agents:sim-123");
		expect(manager.getSubscribers("agents:sim-123").size).toBe(1);

		manager.unsubscribe(socket, "agents:sim-123");

		expect(manager.getSubscribers("agents:sim-123").size).toBe(0);
		manager.removeConnection(socket);
		expect(manager.getSubscribers("agents:sim-123").size).toBe(0);
	});
});
