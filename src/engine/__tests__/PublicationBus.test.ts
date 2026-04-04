import { describe, it, expect } from "vitest";
import { PublicationBus } from "../bus/PublicationBus";
import type { ResearchNote } from "#/types/research";

function makeNote(id: string, publishedAtTick: number): ResearchNote {
	return {
		id,
		agentId: "agent-1",
		focus: "news",
		headline: "Test headline",
		body: "Test body",
		sentiment: "bullish",
		confidence: 0.8,
		symbols: ["AAPL"],
		publishedAtTick,
		releasedToTier: "research",
	};
}

describe("PublicationBus", () => {
	it("releases to tier1 immediately, tier2 after 5 ticks, tier3 after 20 ticks", () => {
		const bus = new PublicationBus();
		const note = makeNote("n1", 5);
		bus.publish(note);

		// Before publication tick — nothing released
		expect(bus.releaseDue(4)).toEqual({ tier1: [], tier2: [], tier3: [] });

		// At tick 5 — tier1 gets it
		const at5 = bus.releaseDue(5);
		expect(at5.tier1).toEqual([note]);
		expect(at5.tier2).toEqual([]);
		expect(at5.tier3).toEqual([]);

		// At tick 10 — tier2 gets it
		const at10 = bus.releaseDue(10);
		expect(at10.tier1).toEqual([]);
		expect(at10.tier2).toEqual([note]);
		expect(at10.tier3).toEqual([]);

		// At tick 25 — tier3 gets it
		const at25 = bus.releaseDue(25);
		expect(at25.tier1).toEqual([]);
		expect(at25.tier2).toEqual([]);
		expect(at25.tier3).toEqual([note]);
	});

	it("does not return duplicates on repeated calls", () => {
		const bus = new PublicationBus();
		bus.publish(makeNote("n1", 0));

		const first = bus.releaseDue(0);
		expect(first.tier1).toHaveLength(1);

		const second = bus.releaseDue(0);
		expect(second.tier1).toHaveLength(0);
	});

	it("handles multiple notes at different ticks", () => {
		const bus = new PublicationBus();
		bus.publish(makeNote("n1", 0));
		bus.publish(makeNote("n2", 3));

		const at0 = bus.releaseDue(0);
		expect(at0.tier1).toHaveLength(1);
		expect(at0.tier1[0].id).toBe("n1");

		const at3 = bus.releaseDue(3);
		expect(at3.tier1).toHaveLength(1);
		expect(at3.tier1[0].id).toBe("n2");
	});
});
