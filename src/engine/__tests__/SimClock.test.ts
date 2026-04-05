import { describe, it, expect } from "vitest";
import { SimClock } from "../sim/SimClock";

describe("SimClock", () => {
	it("starts at tick 0", () => {
		const clock = new SimClock(5);
		expect(clock.simTick).toBe(0);
	});

	it("advances tick and simulatedTime correctly", () => {
		const clock = new SimClock(5);
		const startTime = clock.simulatedTime.getTime();

		for (let i = 0; i < 10; i++) {
			clock.advance();
		}

		expect(clock.simTick).toBe(10);
		expect(clock.simulatedTime.getTime() - startTime).toBe(50_000); // 10 ticks * 5 seconds
	});

	it("starts at 9:30 AM ET", () => {
		const clock = new SimClock(5);
		// Convert to ET and check hours/minutes
		const etString = clock.simulatedTime.toLocaleTimeString("en-US", {
			timeZone: "America/New_York",
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
		});
		expect(etString).toBe("09:30");
	});

	it("reset() restores initial state", () => {
		const clock = new SimClock(5);
		const startTime = clock.simulatedTime.getTime();

		clock.advance();
		clock.advance();
		expect(clock.simTick).toBe(2);

		clock.reset();
		expect(clock.simTick).toBe(0);
		expect(clock.simulatedTime.getTime()).toBe(startTime);
	});

	it("can start from a preloaded tick boundary", () => {
		const clock = new SimClock(5, { initialTick: 60 });
		expect(clock.simTick).toBe(60);

		const startTime = clock.simulatedTime.getTime();
		clock.advance();

		expect(clock.simTick).toBe(61);
		expect(clock.simulatedTime.getTime() - startTime).toBe(5_000);

		clock.reset();
		expect(clock.simTick).toBe(60);
	});
});
