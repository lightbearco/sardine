import type { Category, AgentSeedConfig } from "./types";
import { DEFAULT_MODEL, TIER2_EXTRA_DESCRIPTORS } from "./constants";
import { createSeededRandom, randomSectors } from "./utils";

type Tier2Category = Exclude<
	Category,
	"momentum" | "value" | "noise" | "depth-provider"
>;

export function buildTier2Procedural(
	category: Tier2Category,
	index: number,
	rng: ReturnType<typeof createSeededRandom>,
): AgentSeedConfig {
	const descriptor = rng.pick(TIER2_EXTRA_DESCRIPTORS[category]);
	const sectors = randomSectors(rng, 2, 4);
	const name = `${descriptor
		.split(" ")
		.map((part) => part[0]?.toUpperCase() + part.slice(1))
		.join(" ")} ${index}`;
	const strategy =
		category === "hedge-fund"
			? rng.pick(["long-short", "event-driven", "quality-compounders"])
			: category === "market-maker"
				? rng.pick([
						"tight-spread-liquidity",
						"inventory-skew",
						"volatility-adaptive",
					])
				: rng.pick([
						"income-rebalancing",
						"defensive-allocator",
						"benchmark-drift",
					]);

	const persona =
		category === "hedge-fund"
			? `You are ${name}, a ${descriptor} that trades with institutional discipline and a sharp memory for where crowded trades unwind. You care about catalyst quality, downside control, and not becoming part of the herd.\n\nYour team debates every position through portfolio context, not in isolation. You want differentiated exposure without pretending you can predict everything.`
			: category === "market-maker"
				? `You are ${name}, an ${descriptor} focused on posting usable liquidity while keeping inventory on a short leash. Spread capture matters, but surviving toxic flow matters more.\n\nYou tighten up when conditions are clean, skew when inventory builds, and widen only when order flow becomes dangerous.`
				: `You are ${name}, a ${descriptor} tasked with growing capital for long-dated obligations. You move deliberately, trim outsized winners, and prefer durable balance over flashy moves.\n\nYour process values diversification, liquidity, and the discipline to wait for better prices rather than forcing action.`;
	const personalityTraits =
		category === "hedge-fund"
			? ["analytical", "competitive", "risk-aware", "adaptive"]
			: category === "market-maker"
				? ["systematic", "inventory-aware", "fast", "disciplined"]
				: ["patient", "benchmark-aware", "defensive", "deliberate"];
	const behavioralBiases =
		category === "hedge-fund"
			? ["confirmation-bias", "crowding-awareness"]
			: category === "market-maker"
				? ["spread-fixation", "inventory-aversion"]
				: ["status-quo-bias", "loss-aversion"];
	const currentAgenda =
		category === "hedge-fund"
			? `Rotate capital across ${sectors.join(", ")} names where catalysts or relative value still look mispriced.`
			: category === "market-maker"
				? `Keep liquid two-sided markets in ${sectors.join(", ")} names while flattening sticky inventory quickly.`
				: `Rebalance patiently toward ${sectors.join(", ")} exposure without breaching concentration limits.`;
	const investmentThesis =
		category === "hedge-fund"
			? "Selective sector and catalyst dispersion create more edge than broad market beta."
			: category === "market-maker"
				? "Microstructure edge comes from pricing flow faster and warehousing inventory only briefly."
				: "Long-dated capital compounds best through diversification, patience, and controlled turnover.";
	const quarterlyGoal =
		category === "hedge-fund"
			? "Generate alpha without letting one theme dominate the book."
			: category === "market-maker"
				? "Capture steady spread P&L while keeping inventory risk short-lived."
				: "Protect capital and keep benchmark drift intentional rather than accidental.";
	const constraints =
		category === "hedge-fund"
			? [
					"Avoid oversized single-name conviction.",
					"Cut broken theses quickly.",
				]
			: category === "market-maker"
				? [
						"Do not warehouse inventory longer than necessary.",
						"Adjust spreads when flow turns toxic.",
					]
				: [
						"Favor diversification over concentrated upside.",
						"Trade patiently and keep turnover low.",
					];

	return {
		id: `${category}-${index}`,
		name,
		tier: "tier2",
		entityType: category === "pension" ? "pension-fund" : category,
		strategy,
		persona,
		currentAgenda,
		investmentThesis,
		quarterlyGoal,
		personalityTraits,
		behavioralBiases,
		constraints,
		restrictedSymbols: [],
		sectors,
		risk:
			category === "pension"
				? Number(rng.float(0.18, 0.32).toFixed(3))
				: Number(rng.float(0.38, 0.72).toFixed(3)),
		capital:
			category === "pension"
				? rng.int(30_000_000, 90_000_000)
				: rng.int(18_000_000, 50_000_000),
		model: DEFAULT_MODEL,
		decisionParams:
			category === "hedge-fund"
				? {
						maxGrossLeverage: Number(rng.float(1.1, 1.8).toFixed(3)),
						stopLossPct: Number(rng.float(0.02, 0.05).toFixed(3)),
					}
				: category === "market-maker"
					? {
							spreadTargetBps: Number(rng.float(3, 9).toFixed(3)),
							inventoryLimitPct: Number(rng.float(0.02, 0.08).toFixed(3)),
						}
					: {
							rebalanceDriftPct: Number(rng.float(0.01, 0.03).toFixed(3)),
							maxPositionPct: Number(rng.float(0.02, 0.05).toFixed(3)),
						},
	};
}
