import { describe, expect, it } from "vitest";
import { dashboardLoaderDeps } from "../dashboard.$sessionId";

describe("dashboard session route data flow", () => {
	it("includes symbol search param in loader deps so the loader re-runs on symbol change", () => {
		expect(dashboardLoaderDeps({ search: { symbol: "AAPL" } })).toEqual({
			symbol: "AAPL",
		});
		expect(dashboardLoaderDeps({ search: {} })).toEqual({ symbol: "" });
	});
});
