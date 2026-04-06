import { z } from "zod";
import { DEV_TICKERS, SIM_DEFAULTS } from "#/lib/constants";

export const TRADER_DISTRIBUTION_KEYS = [
	"tier1",
	"hedgeFund",
	"marketMaker",
	"pension",
	"momentum",
	"value",
	"noise",
	"depthProvider",
] as const;

export type TraderDistributionKey = (typeof TRADER_DISTRIBUTION_KEYS)[number];

export interface TraderDistribution {
	tier1: number;
	hedgeFund: number;
	marketMaker: number;
	pension: number;
	momentum: number;
	value: number;
	noise: number;
	depthProvider: number;
}

export const TRADER_DISTRIBUTION_LABELS: Record<TraderDistributionKey, string> =
	{
		tier1: "Tier 1 Institutions",
		hedgeFund: "Hedge Funds",
		marketMaker: "Market Makers",
		pension: "Pensions",
		momentum: "Momentum Traders",
		value: "Value Investors",
		noise: "Noise Traders",
		depthProvider: "Depth Providers",
	};

const TRADER_DISTRIBUTION_WEIGHTS: Record<
	Exclude<TraderDistributionKey, "tier1">,
	number
> = {
	hedgeFund: 3,
	marketMaker: 3,
	pension: 2,
	momentum: 15,
	value: 10,
	noise: 10,
	depthProvider: 5,
};

export const traderDistributionSchema = z.object({
	tier1: z.number().int().min(0).max(2),
	hedgeFund: z.number().int().min(0),
	marketMaker: z.number().int().min(0),
	pension: z.number().int().min(0),
	momentum: z.number().int().min(0),
	value: z.number().int().min(0),
	noise: z.number().int().min(0),
	depthProvider: z.number().int().min(0),
});

export const ALPACA_DATA_TYPE_OPTIONS = [
	"quotes",
	"bars",
	"trades",
	"snapshots",
] as const;

export type AlpacaDataTypeOption = (typeof ALPACA_DATA_TYPE_OPTIONS)[number];

export const ALPACA_DATA_TYPE_LABELS: Record<AlpacaDataTypeOption, string> = {
	quotes: "Quotes",
	bars: "Daily Bars",
	trades: "Trades",
	snapshots: "Snapshots",
};

export const createSimulationSessionInputSchema = z
	.object({
		symbolCount: z.number().int().min(1).max(DEV_TICKERS.length),
		agentCount: z.number().int().min(1).max(250),
		activeGroupSize: z.number().int().min(1).max(250),
		tickIntervalMs: z.number().int().min(0).max(60_000),
		simulatedTickDuration: z.number().int().min(1).max(3_600),
		traderDistribution: traderDistributionSchema,
		llmConcurrency: z
			.number()
			.int()
			.min(1)
			.max(50)
			.default(SIM_DEFAULTS.llmConcurrency),
		llmTimeoutMs: z
			.number()
			.int()
			.min(1000)
			.max(60_000)
			.default(SIM_DEFAULTS.llmTimeoutMs),
		researchFrequency: z
			.number()
			.int()
			.min(1)
			.max(100)
			.default(SIM_DEFAULTS.researchFrequency),
		alpacaDataTypes: z
			.array(z.enum(ALPACA_DATA_TYPE_OPTIONS))
			.nonempty()
			.default(["snapshots"] as AlpacaDataTypeOption[]),
	})
	.superRefine((input, context) => {
		if (input.activeGroupSize > input.agentCount) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "activeGroupSize cannot exceed agentCount",
				path: ["activeGroupSize"],
			});
		}

		if (sumTraderDistribution(input.traderDistribution) !== input.agentCount) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Trader distribution must add up to agentCount",
				path: ["traderDistribution"],
			});
		}
	});

export type CreateSimulationSessionInput = z.infer<
	typeof createSimulationSessionInputSchema
>;

function allocateCounts(
	total: number,
): Record<Exclude<TraderDistributionKey, "tier1">, number> {
	const keys = Object.keys(TRADER_DISTRIBUTION_WEIGHTS) as Array<
		Exclude<TraderDistributionKey, "tier1">
	>;
	const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
		Exclude<TraderDistributionKey, "tier1">,
		number
	>;

	if (total <= 0) {
		return result;
	}

	const totalWeight = keys.reduce(
		(sum, key) => sum + TRADER_DISTRIBUTION_WEIGHTS[key],
		0,
	);
	const provisional = keys.map((key) => {
		const raw = (total * TRADER_DISTRIBUTION_WEIGHTS[key]) / totalWeight;
		return {
			key,
			whole: Math.floor(raw),
			remainder: raw - Math.floor(raw),
		};
	});

	let assigned = 0;
	for (const entry of provisional) {
		result[entry.key] = entry.whole;
		assigned += entry.whole;
	}

	const remaining = total - assigned;
	const winners = [...provisional].sort((left, right) => {
		if (right.remainder !== left.remainder) {
			return right.remainder - left.remainder;
		}

		return keys.indexOf(left.key) - keys.indexOf(right.key);
	});

	for (let index = 0; index < remaining; index += 1) {
		result[winners[index % winners.length].key] += 1;
	}

	return result;
}

export function buildDefaultTraderDistribution(
	agentCount: number,
): TraderDistribution {
	const tier1 = Math.min(2, Math.max(0, agentCount));
	const remaining = Math.max(0, agentCount - tier1);
	const allocated = allocateCounts(remaining);

	return {
		tier1,
		...allocated,
	};
}

export function sumTraderDistribution(
	distribution: TraderDistribution,
): number {
	return TRADER_DISTRIBUTION_KEYS.reduce(
		(total, key) => total + distribution[key],
		0,
	);
}

export function deriveGroupCount(
	agentCount: number,
	activeGroupSize: number,
): number {
	return Math.max(1, Math.ceil(agentCount / Math.max(1, activeGroupSize)));
}

export function buildSessionSymbols(symbolCount: number): string[] {
	return DEV_TICKERS.slice(0, symbolCount).map((ticker) => ticker.symbol);
}

export function buildDefaultSimulationSessionInput(): CreateSimulationSessionInput {
	return {
		symbolCount: SIM_DEFAULTS.symbolCount,
		agentCount: SIM_DEFAULTS.agentCount,
		activeGroupSize: SIM_DEFAULTS.activeGroupSize,
		tickIntervalMs: SIM_DEFAULTS.tickIntervalMs,
		simulatedTickDuration: SIM_DEFAULTS.simulatedTickDuration,
		llmConcurrency: SIM_DEFAULTS.llmConcurrency,
		llmTimeoutMs: SIM_DEFAULTS.llmTimeoutMs,
		researchFrequency: SIM_DEFAULTS.researchFrequency,
		alpacaDataTypes: [
			...SIM_DEFAULTS.alpacaDataTypes,
		] as AlpacaDataTypeOption[],
		traderDistribution: buildDefaultTraderDistribution(SIM_DEFAULTS.agentCount),
	};
}
