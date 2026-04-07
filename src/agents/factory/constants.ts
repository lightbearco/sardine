import { SECTORS } from "#/lib/constants";
import { TRADING_MODEL } from "#/mastra/models";
import type {
	Category,
	DistributionCategory,
	ResearchAgentWorker,
} from "./types";

export { TRADING_MODEL as TIER1_MODEL, TRADING_MODEL as DEFAULT_MODEL };

export const RESEARCH_AGENT_BLUEPRINTS: readonly Omit<
	ResearchAgentWorker,
	"requestContext"
>[] = [
	{
		id: "research-news",
		name: "Research News Desk",
		focus: "news",
		persona:
			"You are a fast-moving equity news analyst. You scan company headlines for earnings surprises, guidance changes, analyst actions, and product-cycle updates that could move large-cap US equities intraday.",
		sources: [
			"https://www.cnbc.com/markets/",
			"https://www.reuters.com/markets/us/",
			"https://www.marketwatch.com/markets",
		],
	},
	{
		id: "research-sentiment",
		name: "Research Sentiment Desk",
		focus: "sentiment",
		persona:
			"You are a market sentiment analyst. You focus on positioning, narrative shifts, and cross-asset risk appetite, translating soft crowd signals into concise trading-facing research notes.",
		sources: [
			"https://www.wsj.com/finance",
			"https://www.bloomberg.com/markets",
			"https://www.investing.com/news/stock-market-news",
		],
	},
	{
		id: "research-macro",
		name: "Research Macro Desk",
		focus: "macro",
		persona:
			"You are a macro research analyst. You track the Fed, rates, inflation, labor data, and sector-sensitive policy signals, then explain which symbols and sectors should care.",
		sources: [
			"https://www.federalreserve.gov/newsevents.htm",
			"https://www.cmegroup.com/markets/interest-rates.html",
			"https://www.bls.gov/news.release/",
		],
	},
] as const;

export const CATEGORY_ORDER: readonly Category[] = [
	"hedge-fund",
	"market-maker",
	"pension",
	"momentum",
	"value",
	"noise",
	"depth-provider",
];

export const DISTRIBUTION_TO_CATEGORY: Record<
	DistributionCategory,
	Category | "tier1"
> = {
	tier1: "tier1",
	hedgeFund: "hedge-fund",
	marketMaker: "market-maker",
	pension: "pension",
	momentum: "momentum",
	value: "value",
	noise: "noise",
	depthProvider: "depth-provider",
};

export const TIER3_ARCHETYPES = {
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

export const FIRST_NAMES = [
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

export const LAST_NAMES = [
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

export const CITIES = [
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

export const BACKSTORIES = [
	"left a discretionary prop desk to trade a personal mandate",
	"built their process after years covering earnings revisions",
	"started with ETFs and slowly concentrated into single-name ideas",
	"treats every session like an audition for outside capital",
	"runs a disciplined process shaped by a painful drawdown two years ago",
	"trusts dashboards and checklists more than TV narratives",
];

export const TIER2_EXTRA_DESCRIPTORS = {
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

export const ALL_SECTORS = SECTORS;

export function clampSectorCount(count: number): number {
	return Math.max(1, Math.min(count, SECTORS.length));
}
