import type { MastraModelConfig } from "@mastra/core/llm";
import {
	buildDefaultTraderDistribution,
	type TraderDistribution,
} from "#/lib/simulation-session";
import { SIM_DEFAULTS } from "#/lib/constants";
import type { AgentConfig } from "#/types/agent";
import type { AgentSeedConfig } from "./types";
import { createSeededRandom } from "./rng";
import { clampSectorCount } from "./constants";
import { ALL_SECTORS } from "./constants";
import type { Sector } from "#/lib/constants";

export { createSeededRandom };

export function deriveModelTier(
	model: MastraModelConfig,
): import("./types").TradingModelTier {
	const modelId =
		typeof model === "string"
			? model
			: "id" in model && typeof model.id === "string"
				? model.id
				: "modelId" in model && typeof model.modelId === "string"
					? model.modelId
					: "";

	if (modelId.includes("pro")) {
		return "sonnet";
	}

	return "haiku";
}

export function deriveMaxInventoryPerName(
	config: AgentConfig,
): number | undefined {
	const explicitLimit = config.decisionParams.maxInventoryPerName;

	if (typeof explicitLimit === "number") {
		return explicitLimit;
	}

	const inventoryLimitPct = config.decisionParams.inventoryLimitPct;
	if (typeof inventoryLimitPct === "number") {
		return Number((config.capital * inventoryLimitPct).toFixed(2));
	}

	const inventoryTolerance = config.decisionParams.inventoryTolerance;
	if (typeof inventoryTolerance === "number") {
		return Number((config.capital * inventoryTolerance).toFixed(2));
	}

	return undefined;
}

export function randomSectors(
	rng: ReturnType<typeof createSeededRandom>,
	min: number,
	max: number,
): Sector[] {
	return rng.sample(ALL_SECTORS, clampSectorCount(rng.int(min, max)));
}

export function assignGroups(
	configs: AgentSeedConfig[],
	groupCount: number,
): AgentConfig[] {
	return configs.map((config, index) => ({
		...config,
		llmGroup: index % groupCount,
	}));
}

export function normalizeTraderDistribution(
	count: number,
	distribution?: TraderDistribution,
): TraderDistribution {
	if (!distribution) {
		return buildDefaultTraderDistribution(count);
	}

	return distribution;
}

export function resolveGroupCount(groupCount: number | undefined): number {
	return groupCount ?? SIM_DEFAULTS.groupCount;
}
