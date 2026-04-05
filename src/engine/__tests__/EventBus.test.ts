import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../bus/EventBus";
import Decimal from "decimal.js";
import type { Trade } from "#/types/market";

describe("EventBus", () => {
	it("delivers typed trade events to listeners", () => {
		const bus = new EventBus();
		const listener = vi.fn();

		bus.on("trade", listener);

		const trade: Trade = {
			id: "t1",
			buyOrderId: "o1",
			sellOrderId: "o2",
			buyerAgentId: "buyer-1",
			sellerAgentId: "seller-1",
			symbol: "AAPL",
			price: new Decimal("150.25"),
			qty: 100,
			tick: 1,
		};

		bus.emit("trade", trade);

		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith(trade);
	});

	it("removes listeners with off()", () => {
		const bus = new EventBus();
		const listener = vi.fn();

		bus.on("tick", listener);
		bus.off("tick", listener);
		bus.emit("tick", { simTick: 1, simulatedTime: new Date() });

		expect(listener).not.toHaveBeenCalled();
	});

	it("removeAllListeners clears a specific event", () => {
		const bus = new EventBus();
		const tradeFn = vi.fn();
		const tickFn = vi.fn();

		bus.on("trade", tradeFn);
		bus.on("tick", tickFn);
		bus.removeAllListeners("trade");

		bus.emit("trade", {} as Trade);
		bus.emit("tick", { simTick: 1, simulatedTime: new Date() });

		expect(tradeFn).not.toHaveBeenCalled();
		expect(tickFn).toHaveBeenCalledOnce();
	});

	it("delivers agent signal and sim state events", () => {
		const bus = new EventBus();
		const signalListener = vi.fn();
		const simStateListener = vi.fn();

		bus.on("agent-event", signalListener);
		bus.on("sim-state", simStateListener);

		bus.emit("agent-event", {
			type: "signal",
			agentId: "agent-1",
			agentName: "Agent 1",
			tick: 2,
			signal: {
				agentId: "agent-1",
				agentName: "Agent 1",
				side: "buy",
				symbol: "AAPL",
				price: 100,
				qty: 5,
				reasoning: "Momentum is improving.",
				tick: 2,
			},
		});
		bus.emit("sim-state", {
			isRunning: true,
			isTicking: false,
			simTick: 2,
			simulatedTime: new Date("2026-04-04T13:30:00.000Z"),
			activeGroupIndex: 0,
			speedMultiplier: 2,
			tickIntervalMs: 500,
			activeGroupSize: 5,
			symbolCount: 10,
			agentCount: 50,
			lastSummary: null,
		});

		expect(signalListener).toHaveBeenCalledOnce();
		expect(simStateListener).toHaveBeenCalledOnce();
	});
});
