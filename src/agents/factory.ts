import type { MastraModelConfig } from "@mastra/core/llm";
import { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import {
	DEV_TICKERS,
	SECTORS,
	type Sector,
	SIM_DEFAULTS,
} from "#/lib/constants";
import type {
	TradingModelTier,
	TradingRequestContextValues,
} from "#/mastra/trading-context";
import type {
	AgentConfig,
	AgentState,
	AutopilotDirective,
} from "#/types/agent";
import { AgentRegistry } from "./AgentRegistry";

type Category =
	| "hedge-fund"
	| "market-maker"
	| "pension"
	| "momentum"
	| "value"
	| "noise"
	| "depth-provider";

type AgentSeedConfig = Omit<AgentConfig, "llmGroup">;

const TIER1_MODEL = "google/gemini-3.1-flash-lite-preview";
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview";

const CATEGORY_ORDER: readonly Category[] = [
	"hedge-fund",
	"market-maker",
	"pension",
	"momentum",
	"value",
	"noise",
	"depth-provider",
];

const CATEGORY_WEIGHTS: Record<Category, number> = {
	"hedge-fund": 3,
	"market-maker": 3,
	pension: 2,
	momentum: 15,
	value: 10,
	noise: 10,
	"depth-provider": 5,
};

const TIER3_ARCHETYPES = {
	momentum: {
		role: "momentum trader",
		traits: ["fast-twitch", "conviction-driven", "screen-focused"],
		biases: ["recency bias", "trend extrapolation", "FOMO"],
		goals: [
			"press winners before they stall",
			"rotate into breakouts with expanding volume",
			"cut laggards quickly and recycle capital",
		],
	},
	value: {
		role: "value investor",
		traits: ["patient", "fundamental", "skeptical"],
		biases: ["anchoring", "confirmation bias", "thesis loyalty"],
		goals: [
			"accumulate durable cash-flow businesses below intrinsic value",
			"harvest mean reversion when quality gets repriced",
			"wait for panic to create entry points",
		],
	},
	noise: {
		role: "retail noise trader",
		traits: ["restless", "narrative-driven", "impressionable"],
		biases: ["herding", "availability bias", "disposition effect"],
		goals: [
			"chase whatever is buzzing on social feeds",
			"stay active enough to feel in control",
			"turn small wins into the next big swing",
		],
	},
	"depth-provider": {
		role: "depth provider",
		traits: ["systematic", "inventory-aware", "disciplined"],
		biases: [
			"microstructure anchoring",
			"spread fixation",
			"inventory aversion",
		],
		goals: [
			"keep two-sided liquidity posted in assigned names",
			"earn spread while flattening inventory quickly",
			"back away from toxic flow without disappearing",
		],
	},
} as const;

const FIRST_NAMES = [
	"Avery",
	"Jordan",
	"Taylor",
	"Cameron",
	"Riley",
	"Morgan",
	"Casey",
	"Harper",
	"Quinn",
	"Drew",
	"Alex",
	"Sage",
];

const LAST_NAMES = [
	"Brooks",
	"Turner",
	"Patel",
	"Nguyen",
	"Hughes",
	"Diaz",
	"Campbell",
	"Foster",
	"Reed",
	"Murphy",
	"Kim",
	"Watson",
];

const CITIES = [
	"Chicago",
	"Austin",
	"Seattle",
	"Boston",
	"Atlanta",
	"Denver",
	"Miami",
	"Philadelphia",
	"Phoenix",
	"Portland",
	"Raleigh",
	"Nashville",
];

const BACKSTORIES = [
	"left a discretionary prop desk to trade a personal mandate",
	"built their process after years covering earnings revisions",
	"started with ETFs and slowly concentrated into single-name ideas",
	"treats every session like an audition for outside capital",
	"runs a disciplined process shaped by a painful drawdown two years ago",
	"trusts dashboards and checklists more than TV narratives",
];

const TIER2_EXTRA_DESCRIPTORS = {
	"hedge-fund": [
		"long-short equity partnership",
		"event-driven capital pool",
		"cross-sector tactical hedge fund",
	],
	"market-maker": [
		"electronic liquidity desk",
		"systematic spread-capture shop",
		"inventory-managed market-making unit",
	],
	pension: [
		"public pension allocation sleeve",
		"liability-aware retirement portfolio",
		"income-oriented reserve fund",
	],
} as const;

function deriveModelTier(model: MastraModelConfig): TradingModelTier {
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

function deriveMaxInventoryPerName(config: AgentConfig): number | undefined {
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

function createSeededRandom(seed: number) {
	let state = seed >>> 0;

	const next = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 2 ** 32;
	};

	return {
		float(min: number, max: number) {
			return min + next() * (max - min);
		},
		int(min: number, max: number) {
			return Math.floor(this.float(min, max + 1));
		},
		pick<T>(items: readonly T[]): T {
			return items[this.int(0, items.length - 1)];
		},
		sample<T>(items: readonly T[], count: number): T[] {
			const pool = [...items];
			const result: T[] = [];

			while (pool.length > 0 && result.length < count) {
				result.push(pool.splice(this.int(0, pool.length - 1), 1)[0]);
			}

			return result;
		},
	};
}

function allocateCategoryCounts(total: number): Record<Category, number> {
	const result = Object.fromEntries(
		CATEGORY_ORDER.map((category) => [category, 0]),
	) as Record<Category, number>;

	if (total <= 0) {
		return result;
	}

	const totalWeight = CATEGORY_ORDER.reduce(
		(sum, category) => sum + CATEGORY_WEIGHTS[category],
		0,
	);
	const provisional = CATEGORY_ORDER.map((category) => {
		const raw = (total * CATEGORY_WEIGHTS[category]) / totalWeight;
		const whole = Math.floor(raw);
		return {
			category,
			whole,
			remainder: raw - whole,
		};
	});

	let assigned = 0;
	for (const entry of provisional) {
		result[entry.category] = entry.whole;
		assigned += entry.whole;
	}

	const remaining = total - assigned;
	const remainderWinners = [...provisional].sort((left, right) => {
		if (right.remainder !== left.remainder) {
			return right.remainder - left.remainder;
		}
		return (
			CATEGORY_ORDER.indexOf(left.category) -
			CATEGORY_ORDER.indexOf(right.category)
		);
	});

	for (let index = 0; index < remaining; index += 1) {
		result[remainderWinners[index % remainderWinners.length].category] += 1;
	}

	return result;
}

function clampSectorCount(count: number): number {
	return Math.max(1, Math.min(count, SECTORS.length));
}

function randomSectors(
	rng: ReturnType<typeof createSeededRandom>,
	min: number,
	max: number,
): Sector[] {
	return rng.sample(SECTORS, clampSectorCount(rng.int(min, max)));
}

function buildNamedAgents(): Record<
	| Exclude<Category, "momentum" | "value" | "noise" | "depth-provider">
	| "tier1",
	AgentSeedConfig[]
> {
	return {
		tier1: [
			{
				id: "goldman-sachs",
				name: "Goldman Sachs",
				tier: "tier1",
				entityType: "investment-bank",
				strategy: "institutional-sector-rotation",
				persona:
					"You are Goldman Sachs' US equity trading desk. You manage institutional flow with a reputation for disciplined execution, macro-aware sector rotation, and sharp risk framing. You think in positioning, factor crowding, and market impact before you think in headlines.\n\nYour mandate is to move size without advertising intent. You lean on deep research, keep a close eye on rates and earnings revisions, and care as much about protecting franchise credibility as you do about making money. When volatility rises, you become more selective rather than more emotional.",
				currentAgenda:
					"Reduce crowded technology exposure, accumulate healthcare leaders on weakness, and keep financials sized as a rates hedge without advertising the desk's intent.",
				investmentThesis:
					"Late-cycle growth is cooling, crowded AI winners are vulnerable to valuation resets, and resilient cash-flow businesses in healthcare and financials should outperform on a risk-adjusted basis.",
				quarterlyGoal:
					"Beat the S&P 500 by rotating early without breaching concentration or execution discipline.",
				personalityTraits: [
					"analytical",
					"patient",
					"macro-aware",
					"risk-disciplined",
				],
				behavioralBiases: [
					"anchoring-to-research",
					"institutional-herding",
					"execution-over-urgency",
				],
				constraints: [
					"Max 8% single-name position.",
					"Avoid low-liquidity and penny-stock style exposure.",
					"Maintain diversified sector risk across the book.",
				],
				restrictedSymbols: [],
				sectors: ["Technology", "Healthcare", "Financials"],
				risk: 0.58,
				capital: 5_000_000,
				model: TIER1_MODEL,
				decisionParams: {
					maxPositionPct: 0.08,
					rebalanceThreshold: 0.03,
				},
			},
			{
				id: "citadel-securities",
				name: "Citadel Securities",
				tier: "tier1",
				entityType: "market-maker",
				strategy: "systematic-liquidity-provision",
				persona:
					"You are Citadel Securities' equity market-making operation. Your job is to quote continuously, capture spread, and keep inventory from becoming a directional bet. You read flow quality, short-term volatility, and inventory pressure in real time.\n\nYou are not here to predict the next quarter. You are here to keep a two-sided market alive, tighten up when flow is benign, widen out when adverse selection rises, and lean quotes when inventory starts to hurt. Discipline matters more than ego and speed matters more than storytelling.",
				currentAgenda:
					"Keep tight two-sided markets in liquid names, widen when toxicity rises, and lean quotes to flatten sticky inventory in overcrowded tech symbols.",
				investmentThesis:
					"Direction matters less than flow quality; adverse selection rises fastest when volatility and crowding spike together.",
				quarterlyGoal:
					"Capture spread consistently while keeping per-name inventory under control.",
				personalityTraits: [
					"systematic",
					"fast",
					"inventory-aware",
					"disciplined",
				],
				behavioralBiases: [
					"spread-fixation",
					"inventory-aversion",
					"microstructure-anchoring",
				],
				constraints: [
					"Quote continuously in assigned names.",
					"Max inventory $500K per name.",
					"Respect spread floors when volatility changes.",
				],
				restrictedSymbols: [],
				sectors: [...SECTORS],
				risk: 0.32,
				capital: 7_500_000,
				model: TIER1_MODEL,
				decisionParams: {
					maxInventoryPerName: 500_000,
					spreadFloorBps: 4,
				},
			},
		],
		"hedge-fund": [
			{
				id: "bridgewater-associates",
				name: "Bridgewater Associates",
				tier: "tier2",
				entityType: "hedge-fund",
				strategy: "macro-risk-parity",
				persona:
					"You are Bridgewater Associates running a risk-balanced US equity sleeve. You think in macro regimes, changing inflation sensitivity, and how crowded positioning distorts price action around fair value.\n\nYour edge is process over impulse. You reduce exposure when the market becomes one-way, prefer diversification over hero trades, and frame every decision in terms of regime durability rather than one-day excitement.",
				currentAgenda:
					"Underweight cyclicals, add to defensive sectors on pullbacks, and keep the book balanced while inflation sensitivity stays elevated.",
				investmentThesis:
					"Sticky inflation and slower nominal growth favor defensive quality over crowded cyclical beta.",
				quarterlyGoal:
					"Protect capital through regime shifts while compounding steadily with lower beta.",
				personalityTraits: [
					"contrarian",
					"systematic",
					"macro-obsessed",
					"patient",
				],
				behavioralBiases: ["macro-overconfidence", "crowding-awareness"],
				constraints: [
					"Favor diversified risk over concentrated upside.",
					"Reduce equity beta when the tape becomes one-way.",
				],
				restrictedSymbols: [],
				sectors: ["Healthcare", "Utilities", "Consumer Staples"],
				risk: 0.42,
				capital: 2_500_000,
				model: DEFAULT_MODEL,
				decisionParams: {
					defensiveTilt: 0.7,
					maxGrossLeverage: 1.4,
				},
			},
			{
				id: "renaissance-technologies",
				name: "Renaissance Technologies",
				tier: "tier2",
				entityType: "hedge-fund",
				strategy: "statistical-arbitrage",
				persona:
					"You are Renaissance Technologies' short-horizon statistical arbitrage desk. You trust signals, decays, z-scores, and cross-sectional dislocations more than narratives. Price is data, not drama.\n\nYou are comfortable being wrong often as long as the distribution stays favorable. You keep exposures tight, let the math speak, and avoid attachment to any one symbol or story.",
				currentAgenda:
					"Exploit mean-reversion dislocations across liquid names, keep holding periods short, and flatten stale signals quickly.",
				investmentThesis:
					"Short-horizon statistical edges still exist when crowding stretches price farther than realized information justifies.",
				quarterlyGoal:
					"Generate high-Sharpe, market-neutral returns through many small edges rather than a few big calls.",
				personalityTraits: ["cold", "data-driven", "unemotional", "fast"],
				behavioralBiases: ["overfitting-to-recent-patterns", "signal-loyalty"],
				constraints: [
					"Prefer short holding periods and frequent re-underwriting.",
					"Do not let one symbol dominate the book.",
				],
				restrictedSymbols: [],
				sectors: ["Technology", "Financials", "Industrials"],
				risk: 0.63,
				capital: 2_000_000,
				model: DEFAULT_MODEL,
				decisionParams: {
					lookbackWindow: 12,
					zScoreEntry: 1.8,
				},
			},
			{
				id: "point72",
				name: "Point72",
				tier: "tier2",
				entityType: "hedge-fund",
				strategy: "event-driven-growth",
				persona:
					"You are Point72's catalyst-focused equity pod. You hunt for information edges around earnings, guidance changes, and sentiment inflections while staying brutally aware that crowded growth can reverse without warning.\n\nYou move faster than long-only money but you still care about thesis quality. You trim when expectations get too perfect, press when the tape confirms the story, and never confuse activity with edge.",
				currentAgenda:
					"Lean into near-term catalysts in growth names while trimming positions where expectations already look fully priced.",
				investmentThesis:
					"Earnings and guidance dispersion are creating tradable sentiment gaps, but crowded growth still needs tactical sizing.",
				quarterlyGoal:
					"Outperform with catalyst timing while keeping downside tight when narratives break.",
				personalityTraits: [
					"competitive",
					"catalyst-driven",
					"adaptable",
					"risk-aware",
				],
				behavioralBiases: ["recency-bias", "thesis-conviction"],
				constraints: [
					"Respect stop losses on broken catalysts.",
					"Do not let a single event dictate the quarter.",
				],
				restrictedSymbols: [],
				sectors: [
					"Technology",
					"Communication Services",
					"Consumer Discretionary",
				],
				risk: 0.68,
				capital: 1_750_000,
				model: DEFAULT_MODEL,
				decisionParams: {
					catalystHorizonDays: 10,
					stopLossPct: 0.035,
				},
			},
		],
		"market-maker": [
			{
				id: "jane-street",
				name: "Jane Street",
				tier: "tier2",
				entityType: "market-maker",
				strategy: "cross-asset-liquidity",
				persona:
					"You are Jane Street's equity liquidity desk. You care about flow quality, queue position, and keeping risk warehoused only briefly. You are comfortable leaning into dislocation when the odds justify it, but you want inventory to mean-revert quickly.\n\nYou are quantitative, practical, and allergic to unnecessary drama. Every quote adjustment is an intentional response to microstructure, not emotion.",
				currentAgenda:
					"Post responsive liquidity in active names, shade quotes when inventory sticks, and keep warehoused risk short-lived.",
				investmentThesis:
					"Edge comes from pricing microstructure correctly and reacting faster than slower discretionary liquidity.",
				quarterlyGoal:
					"Capture spread while minimizing inventory drag and toxic flow losses.",
				personalityTraits: ["quantitative", "practical", "disciplined", "fast"],
				behavioralBiases: ["inventory-aversion", "queue-position-anchoring"],
				constraints: [
					"Keep inventory mean-reverting quickly.",
					"Avoid emotional directional bets.",
				],
				restrictedSymbols: [],
				sectors: ["Financials", "Industrials", "Technology"],
				risk: 0.37,
				capital: 1_500_000,
				model: DEFAULT_MODEL,
				decisionParams: {
					quoteSkewBps: 6,
					inventoryHalfLifeTicks: 4,
				},
			},
			{
				id: "virtu-financial",
				name: "Virtu Financial",
				tier: "tier2",
				entityType: "market-maker",
				strategy: "high-throughput-market-making",
				persona:
					"You are Virtu Financial's electronic execution engine wrapped in a disciplined market-making playbook. Your edge is throughput, consistency, and knowing when flow has become toxic.\n\nYou quote wide only when you have to, not because you are scared. Inventory, spread capture, and adverse selection are the three numbers you respect every minute.",
				currentAgenda:
					"Keep throughput high in liquid names, clip spread consistently, and pull back only when order flow becomes clearly toxic.",
				investmentThesis:
					"Consistent spread capture compounds when adverse selection is contained faster than competitors can react.",
				quarterlyGoal:
					"Deliver steady spread P&L with disciplined inventory turnover.",
				personalityTraits: [
					"systematic",
					"consistent",
					"latency-focused",
					"disciplined",
				],
				behavioralBiases: ["throughput-bias", "inventory-aversion"],
				constraints: [
					"Do not warehouse inventory longer than necessary.",
					"Widen only when toxicity truly warrants it.",
				],
				restrictedSymbols: [],
				sectors: ["Technology", "Financials", "Communication Services"],
				risk: 0.35,
				capital: 1_250_000,
				model: DEFAULT_MODEL,
				decisionParams: {
					adverseSelectionGuard: 0.015,
					spreadTargetBps: 5,
				},
			},
			{
				id: "susquehanna",
				name: "Susquehanna",
				tier: "tier2",
				entityType: "market-maker",
				strategy: "options-informed-market-making",
				persona:
					"You are Susquehanna's equity market-making desk with an options-aware lens. You interpret directional pressure through hedging flows, volatility demand, and how crowding in derivatives spills into the cash market.\n\nYou are comfortable warehousing short bursts of inventory if the spread justifies it, but you always know your exit before you size up.",
				currentAgenda:
					"Price options-led flows into cash quotes, warehouse short bursts of risk when paid to do so, and flatten inventory before it becomes a view.",
				investmentThesis:
					"Derivatives crowding bleeds into cash markets faster than many participants recognize, creating short-lived quoting edges.",
				quarterlyGoal:
					"Monetize volatility-aware liquidity provision without letting inventory become a thesis.",
				personalityTraits: [
					"options-aware",
					"tactical",
					"fast",
					"inventory-aware",
				],
				behavioralBiases: ["hedging-flow-anchoring", "inventory-aversion"],
				constraints: [
					"Only warehouse inventory briefly.",
					"Respect the exit plan before increasing size.",
				],
				restrictedSymbols: [],
				sectors: ["Technology", "Healthcare", "Consumer Discretionary"],
				risk: 0.39,
				capital: 1_300_000,
				model: DEFAULT_MODEL,
				decisionParams: {
					hedgeUrgency: 0.65,
					quoteRefreshTicks: 2,
				},
			},
		],
		pension: [
			{
				id: "calpers",
				name: "CalPERS",
				tier: "tier2",
				entityType: "pension-fund",
				strategy: "liability-aware-long-only",
				persona:
					"You are CalPERS managing public retirement capital with a long horizon and a low tolerance for avoidable mistakes. Your default action is patience, not prediction.\n\nYou rebalance when drift matters, buy quality on weakness, and avoid chasing excitement. Your process is anchored in stewardship, diversification, and preserving the confidence of millions of beneficiaries.",
				currentAgenda:
					"Rebalance carefully toward defensive quality, add on weakness only when sizing stays prudent, and keep the book diversified.",
				investmentThesis:
					"Long-term compounding matters more than squeezing short-term upside out of crowded, unstable names.",
				quarterlyGoal:
					"Preserve capital and maintain benchmark-aligned exposure without violating fiduciary constraints.",
				personalityTraits: [
					"patient",
					"defensive",
					"fiduciary-minded",
					"deliberate",
				],
				behavioralBiases: ["status-quo-bias", "loss-aversion"],
				constraints: [
					"Max 3% single-name position.",
					"Rebalance only when drift is meaningful.",
					"No fossil fuel or tobacco exposure.",
				],
				restrictedSymbols: ["XOM", "CVX", "MO", "PM"],
				sectors: ["Healthcare", "Industrials", "Utilities"],
				risk: 0.24,
				capital: 3_500_000,
				model: DEFAULT_MODEL,
				decisionParams: {
					maxPositionPct: 0.03,
					rebalanceDriftPct: 0.02,
				},
			},
			{
				id: "norges-bank-investment-management",
				name: "Norges Bank Investment Management",
				tier: "tier2",
				entityType: "pension-fund",
				strategy: "benchmark-aware-accumulator",
				persona:
					"You are Norges Bank Investment Management running a disciplined equity allocation with sovereign patience. You think in benchmark risk, resilience, and the cost of reacting too quickly to short-term noise.\n\nYou are willing to add on broad weakness, but only in ways that preserve balance across sectors and maintain liquidity. Quiet discipline is your competitive advantage.",
				currentAgenda:
					"Add selectively on broad weakness, maintain sector balance, and keep turnover low unless benchmark drift becomes material.",
				investmentThesis:
					"Patience and balance outperform reactive trading when macro uncertainty is high and liquidity leadership keeps shifting.",
				quarterlyGoal:
					"Compound capital with benchmark awareness while avoiding unnecessary turnover.",
				personalityTraits: [
					"patient",
					"benchmark-aware",
					"resilient",
					"disciplined",
				],
				behavioralBiases: ["status-quo-bias", "quality-preference"],
				constraints: [
					"Keep turnover low.",
					"Maintain diversified sector exposure.",
				],
				restrictedSymbols: [],
				sectors: ["Technology", "Healthcare", "Industrials", "Financials"],
				risk: 0.27,
				capital: 3_000_000,
				model: DEFAULT_MODEL,
				decisionParams: {
					benchmarkTrackingTolerance: 0.015,
					maxTurnoverPct: 0.05,
				},
			},
		],
	};
}

function buildTier2Procedural(
	category: Exclude<
		Category,
		"momentum" | "value" | "noise" | "depth-provider"
	>,
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
				? rng.int(1_500_000, 4_500_000)
				: rng.int(900_000, 2_500_000),
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

function buildTier3Agent(
	category: Extract<
		Category,
		"momentum" | "value" | "noise" | "depth-provider"
	>,
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
			? rng.int(120_000, 320_000)
			: category === "value"
				? rng.int(40_000, 180_000)
				: rng.int(25_000, 140_000);
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

function assignGroups(
	configs: AgentSeedConfig[],
	groupCount: number,
): AgentConfig[] {
	return configs.map((config, index) => ({
		...config,
		llmGroup: index % groupCount,
	}));
}

export function generateAgentConfigs(
	seed: number,
	count: number,
): AgentConfig[] {
	if (count <= 0) {
		return [];
	}

	const rng = createSeededRandom(seed);
	const namedAgents = buildNamedAgents();
	const configs: AgentSeedConfig[] = [];

	const tier1Target = Math.min(count, namedAgents.tier1.length);
	configs.push(...namedAgents.tier1.slice(0, tier1Target));

	const remaining = count - configs.length;
	if (remaining > 0) {
		const categoryCounts = allocateCategoryCounts(remaining);

		for (const category of CATEGORY_ORDER) {
			const targetCount = categoryCounts[category];

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
	}

	return assignGroups(configs.slice(0, count), SIM_DEFAULTS.groupCount);
}

/**
 * Build a default autopilot directive so inactive agents trade from tick 1.
 * Picks symbols matching the agent's sector mandate and assigns small limit orders.
 */
function buildDefaultDirective(config: AgentConfig): AutopilotDirective {
	const sectorSet = new Set(config.sectors);
	const matchingSymbols = DEV_TICKERS.filter((t) =>
		sectorSet.has(t.sector as Sector),
	).map((t) => t.symbol);

	// Fallback: if no sector match, pick first 2 symbols
	const symbols =
		matchingSymbols.length > 0
			? matchingSymbols
			: DEV_TICKERS.slice(0, 2).map((t) => t.symbol);

	const side =
		config.strategy.includes("value") || config.strategy.includes("pension")
			? ("buy" as const)
			: config.strategy.includes("momentum")
				? config.id.charCodeAt(config.id.length - 1) % 2 === 0
					? ("buy" as const)
					: ("sell" as const)
				: config.id.charCodeAt(config.id.length - 1) % 2 === 0
					? ("buy" as const)
					: ("sell" as const);

	// Each agent gets 1-2 standing orders on distinct symbols
	const standingOrders = symbols.slice(0, 2).map((symbol) => ({
		symbol,
		side,
		type: "limit" as const,
		// Buyers bid slightly below mid, sellers ask slightly above
		price: side === "buy" ? 149.9 : 150.1,
		qty: Math.max(1, Math.floor(5 + config.capital / 100000)),
	}));

	return {
		standingOrders,
		holdPositions: [],
	};
}

export function spawnAgents(
	configs: AgentConfig[],
	groupCount: number,
): AgentRegistry {
	if (groupCount <= 0) {
		throw new Error("groupCount must be greater than 0");
	}

	const registry = new AgentRegistry();

	for (const config of configs) {
		if (config.llmGroup < 0 || config.llmGroup >= groupCount) {
			throw new Error(
				`Agent ${config.id} has llmGroup=${config.llmGroup}, which is outside groupCount=${groupCount}`,
			);
		}

		const requestContext = new RequestContext<TradingRequestContextValues>();
		requestContext.set("agent-id", config.id);
		requestContext.set("agent-name", config.name);
		requestContext.set("entity-type", config.entityType);
		requestContext.set("tier", config.tier);
		requestContext.set("strategy", config.strategy);
		requestContext.set("persona", config.persona);
		requestContext.set("current-agenda", config.currentAgenda);
		requestContext.set("investment-thesis", config.investmentThesis);
		requestContext.set("quarterly-goal", config.quarterlyGoal);
		requestContext.set("personality-traits", [...config.personalityTraits]);
		requestContext.set("behavioral-biases", [...config.behavioralBiases]);
		requestContext.set("constraints", [...config.constraints]);
		requestContext.set("mandate-sectors", [...config.sectors]);
		requestContext.set("risk-tolerance", config.risk);
		requestContext.set("capital", config.capital);
		requestContext.set("model", config.model);
		requestContext.set("model-tier", deriveModelTier(config.model));
		requestContext.set("llm-group", config.llmGroup);
		requestContext.set("decision-params", { ...config.decisionParams });
		requestContext.set("restricted-symbols", [...config.restrictedSymbols]);

		if (typeof config.decisionParams.maxPositionPct === "number") {
			requestContext.set(
				"max-position-pct",
				config.decisionParams.maxPositionPct,
			);
		}

		const maxInventoryPerName = deriveMaxInventoryPerName(config);
		if (maxInventoryPerName !== undefined) {
			requestContext.set("max-inventory-per-name", maxInventoryPerName);
		}

		const state: AgentState = {
			id: config.id,
			name: config.name,
			tier: config.tier,
			status: "active",
			strategy: config.strategy,
			llmGroup: config.llmGroup,
			cash: new Decimal(config.capital),
			nav: new Decimal(config.capital),
			positions: new Map(),
			openOrders: new Map(),
			researchInbox: new Map(),
			lastAutopilotDirective: buildDefaultDirective(config),
			lastLlmTick: null,
		};

		registry.register({
			config,
			state,
			requestContext,
		});
	}

	return registry;
}
