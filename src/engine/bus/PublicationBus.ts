import type { ResearchNote } from "#/types/research";

const TIER_DELAYS = { tier1: 0, tier2: 5, tier3: 20 } as const;

type TierKey = keyof typeof TIER_DELAYS;

export class PublicationBus {
	private queue: ResearchNote[] = [];
	private released = new Map<TierKey, Set<string>>();

	constructor() {
		this.released.set("tier1", new Set());
		this.released.set("tier2", new Set());
		this.released.set("tier3", new Set());
	}

	publish(note: ResearchNote): void {
		this.queue.push(note);
	}

	releaseDue(simTick: number): {
		tier1: ResearchNote[];
		tier2: ResearchNote[];
		tier3: ResearchNote[];
	} {
		const result = { tier1: [] as ResearchNote[], tier2: [] as ResearchNote[], tier3: [] as ResearchNote[] };

		for (const note of this.queue) {
			for (const tier of ["tier1", "tier2", "tier3"] as const) {
				const releasedSet = this.released.get(tier)!;
				if (!releasedSet.has(note.id) && simTick >= note.publishedAtTick + TIER_DELAYS[tier]) {
					result[tier].push(note);
					releasedSet.add(note.id);
				}
			}
		}

		return result;
	}
}
