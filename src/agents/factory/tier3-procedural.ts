import type { Category, AgentSeedConfig } from "./types";
import {
	DEFAULT_MODEL,
	TIER3_ARCHETYPES,
	FIRST_NAMES,
	LAST_NAMES,
	CITIES,
	BACKSTORIES,
} from "./constants";
import { createSeededRandom, randomSectors } from "./utils";

type Tier3Category = Extract<
	Category,
	"momentum" | "value" | "noise" | "depth-provider"
>;

export function buildTier3Agent(
	category: Tier3Category,
	index: number,
	rng: ReturnType<typeof createSeededRandom>,
): AgentSeedConfig {
	const firstName = rng.pick(FIRST_NAMES);
	const lastName = rng.pick(LAST_NAMES);
	const city = rng.pick(CITIES);
	const age = rng.int(27, 68);
	const sectors = randomSectors(
		rng,
		category === "depth-provider" ? 2 : 1,
		category === "depth-provider" ? 4 : 3,
	);
	const profile = TIER3_ARCHETYPES[category];
	const backstory = rng.pick(BACKSTORIES);
	const goal = rng.pick(profile.goals);
	const risk =
		category === "depth-provider"
			? Number(rng.float(0.18, 0.36).toFixed(3))
			: category === "noise"
				? Number(rng.float(0.55, 0.95).toFixed(3))
				: Number(rng.float(0.28, 0.78).toFixed(3));
	const capital =
		category === "depth-provider"
			? rng.int(2_400_000, 6_400_000)
			: category === "value"
				? rng.int(800_000, 3_600_000)
				: rng.int(500_000, 2_800_000);
	const decisionParams: Record<string, number> =
		category === "momentum"
			? {
					lookback: rng.int(5, 30),
					entryThreshold: Number(rng.float(0.01, 0.04).toFixed(3)),
					riskFraction: Number(rng.float(0.03, 0.12).toFixed(3)),
				}
			: category === "value"
				? {
						discountThreshold: Number(rng.float(0.08, 0.2).toFixed(3)),
						holdingHorizonDays: rng.int(20, 120),
						maxPositionPct: Number(rng.float(0.08, 0.22).toFixed(3)),
					}
				: category === "noise"
					? {
							chaseProbability: Number(rng.float(0.4, 0.95).toFixed(3)),
							stopLossPct: Number(rng.float(0.03, 0.12).toFixed(3)),
							turnoverBias: Number(rng.float(0.5, 0.95).toFixed(3)),
						}
					: {
							spreadBps: Number(rng.float(4, 12).toFixed(3)),
							inventoryTolerance: Number(rng.float(0.01, 0.04).toFixed(3)),
							requoteTicks: rng.int(1, 4),
						};
	const name =
		category === "depth-provider"
			? `Depth Provider ${index}`
			: `${firstName} ${lastName}`;
	const persona = `You are ${name}, a ${age}-year-old ${profile.role} based in ${city}. You ${backstory}. Your watchlist stays anchored to ${sectors.join(", ")} and you talk about risk in practical, lived-in terms rather than theory.

Your temperament is ${profile.traits.join(", ")}. You regularly show ${profile.biases.join(", ")} in the way you frame decisions. Right now you want to ${goal}. You run this mandate as strategy sleeve ${category}-${index}, which colors how you size risk and talk about performance. You are believable precisely because you are not perfectly rational.`;
	const currentAgenda = `Focus on ${sectors.join(", ")} names and ${goal}.`;
	const investmentThesis =
		category === "momentum"
			? "Strength that confirms with volume deserves to be ridden until the tape says otherwise."
			: category === "value"
				? "Quality dislocations mean-revert when fear overshoots fundamentals."
				: category === "noise"
					? "Narrative and social proof can push prices farther than fundamentals in the short run."
					: "Spread capture and inventory discipline matter more than predicting direction.";
	const quarterlyGoal =
		category === "depth-provider"
			? "Earn reliable spread income while keeping inventory flat enough to survive volatility."
			: `Grow this ${category} sleeve without a drawdown large enough to force de-risking.`;
	const constraints =
		category === "momentum"
			? ["Keep sizes moderate and rotate when momentum fades."]
			: category === "value"
				? [
						`Respect a max single-name size near ${(decisionParams.maxPositionPct * 100).toFixed(0)}%.`,
						"Be patient when waiting for mean reversion.",
					]
				: category === "noise"
					? ["Do not let one YOLO idea wipe out the account."]
					: ["Keep inventory per name small relative to account size."];

	return {
		id: `${category}-${index}`,
		name,
		tier: "tier3",
		entityType: category === "depth-provider" ? "liquidity-provider" : "retail",
		strategy: category,
		persona,
		currentAgenda,
		investmentThesis,
		quarterlyGoal,
		personalityTraits: [...profile.traits],
		behavioralBiases: [...profile.biases],
		constraints,
		restrictedSymbols: [],
		sectors,
		risk,
		capital,
		model: DEFAULT_MODEL,
		decisionParams,
	};
}
