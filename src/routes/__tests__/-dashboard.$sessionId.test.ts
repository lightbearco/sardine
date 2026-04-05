import { describe, expect, it } from "vitest";
import { dashboardLoaderDeps } from "../dashboard.$sessionId";

describe("dashboard session route data flow", () => {
	it("does not treat search-state changes as full loader dependencies", () => {
		expect(dashboardLoaderDeps()).toEqual({});
	});
});
