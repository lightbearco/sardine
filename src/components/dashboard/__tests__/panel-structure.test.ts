import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
	return readFileSync(
		new URL(`../${relativePath}`, import.meta.url),
		"utf8",
	);
}

describe("dashboard panel structure", () => {
	it("keeps virtualization wired into the dense list panels", () => {
		const watchlist = read("Watchlist.tsx");
		const timeAndSales = read("TimeAndSales.tsx");
		const blotter = read("Blotter.tsx");
		const agentsPanel = read("AgentsPanel.tsx");

		expect(watchlist).toContain('useVirtualizer');
		expect(watchlist).toContain("overscan: 5");
		expect(timeAndSales).toContain('useVirtualizer');
		expect(timeAndSales).toContain("overscan: 6");
		expect(blotter).toContain('useVirtualizer');
		expect(blotter).toContain("overscan: 6");
		expect(agentsPanel).toContain('useVirtualizer');
		expect(agentsPanel).toContain("overscan: 6");
	});

	it("keeps the non-virtualized panels on direct scroll/render paths", () => {
		const orderBook = read("OrderBookPanel.tsx");
		const researchFeed = read("ResearchFeed.tsx");
		const topBar = read("TopBar.tsx");

		expect(orderBook).not.toContain("useVirtualizer");
		expect(researchFeed).not.toContain("useVirtualizer");
		expect(topBar).not.toContain("useVirtualizer");
	});
});
