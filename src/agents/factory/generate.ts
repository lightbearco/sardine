import type { TraderDistribution } from "#/lib/simulation-session";
import type { AgentConfig } from "#/types/agent";
import type { AgentSeedConfig, DistributionCategory } from "./types";
import { CATEGORY_ORDER, DISTRIBUTION_TO_CATEGORY } from "./constants";
import {
	createSeededRandom,
	assignGroups,
	normalizeTraderDistribution,
	resolveGroupCount,
} from "./utils";
import { buildNamedAgents } from "./named-agents";
import { buildTier2Procedural } from "./tier2-procedural";
import { buildTier3Agent } from "./tier3-procedural";

export function generateAgentConfigs(
	seed: number,
	count: number,
	options: {
		groupCount?: number;
		traderDistribution?: TraderDistribution;
	} = {},
): AgentConfig[] {
	if (count <= 0) {
		return [];
	}

	const rng = createSeededRandom(seed);
	const namedAgents = buildNamedAgents();
	const configs: AgentSeedConfig[] = [];
	const groupCount = resolveGroupCount(options.groupCount);
	const traderDistribution = normalizeTraderDistribution(
		count,
		options.traderDistribution,
	);

	const tier1Target = Math.min(
		count,
		namedAgents.tier1.length,
		traderDistribution.tier1,
	);
	configs.push(...namedAgents.tier1.slice(0, tier1Target));

	for (const category of CATEGORY_ORDER) {
		const distributionKey = (Object.entries(DISTRIBUTION_TO_CATEGORY).find(
			([, value]) => value === category,
		)?.[0] ?? null) as Exclude<DistributionCategory, "tier1"> | null;
		const targetCount =
			distributionKey === null ? 0 : traderDistribution[distributionKey];

		if (targetCount === 0) {
			continue;
		}

		if (
			category === "hedge-fund" ||
			category === "market-maker" ||
			category === "pension"
		) {
			const namedForCategory = namedAgents[category];
			const namedCount = Math.min(targetCount, namedForCategory.length);
			configs.push(...namedForCategory.slice(0, namedCount));

			for (let index = namedCount + 1; index <= targetCount; index += 1) {
				configs.push(buildTier2Procedural(category, index, rng));
			}
			continue;
		}

		for (let index = 1; index <= targetCount; index += 1) {
			configs.push(buildTier3Agent(category, index, rng));
		}
	}

	return assignGroups(configs.slice(0, count), groupCount);
}
