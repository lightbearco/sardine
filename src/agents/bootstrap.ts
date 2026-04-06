import Decimal from "decimal.js";
import type { AgentRegistry } from "#/agents/AgentRegistry";
import {
	generateAgentConfigs,
	spawnAgents,
	spawnResearchAgents,
	type ResearchAgentWorker,
} from "#/agents/factory";
import { serializeAgentEntriesForDb } from "#/agents/persistence";
import type { BootstrapMarketData } from "#/alpaca/live-feed";
import { db } from "#/db/index";
import {
	agents as agentsTable,
	orderBookSnapshots as orderBookSnapshotsTable,
	orders as ordersTable,
	simConfig as simConfigTable,
	ticks as ticksTable,
} from "#/db/schema";
import { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SimClock } from "#/engine/sim/SimClock";
import { DEV_TICKERS, type Sector } from "#/lib/constants";
import type { TraderDistribution } from "#/lib/simulation-session";
import { serializeOrderBookSnapshot } from "#/server/sessions";
import type { AgentConfig, AutopilotDirective, Position } from "#/types/agent";
import type { Order, OrderStatus, Trade } from "#/types/market";
import type { ResearchNote } from "#/types/research";
import type { TickSummary } from "#/types/sim";
import { cloneResearchRequestContext } from "#/mastra/research-context";

export type { ResearchAgentWorker } from "#/agents/factory";

const DEFAULT_SEED_PRICE = new Decimal(150);
const DEFAULT_SEED_SPREAD = new Decimal("0.10");
const MIN_SPREAD = new Decimal("0.02");
const DEFAULT_BOOK_DEPTH = 5;
const DEFAULT_BOOK_QTY = 100;

type SeededRandom = ReturnType<typeof createSeededRandom>;

export interface BootstrapSimulationInput {
	sessionId: string;
	symbols: string[];
	seed: number;
	agentCount: number;
	groupCount: number;
	tickIntervalMs: number;
	simulatedTickDuration: number;
	traderDistribution: TraderDistribution;
	marketData?: BootstrapMarketData | null;
}

export interface BootstrapSimulationResult {
	sessionId: string;
	symbols: string[];
	initialTick: number;
	matchingEngine: MatchingEngine;
	agentRegistry: AgentRegistry;
	researchWorkers: ResearchAgentWorker[];
}

type PersistedPositionRecord = Record<string, { qty: number; avgCost: number }>;

export interface RestoreSimulationInput {
	sessionId: string;
	symbols: string[];
	seed: number;
	agentCount: number;
	groupCount: number;
	tickIntervalMs: number;
	simulatedTickDuration: number;
	traderDistribution: TraderDistribution;
	persistedState: {
		simConfig: {
			isRunning: boolean;
			currentTick: number;
			simulatedMarketTime: Date | null;
			speedMultiplier: number;
			tickIntervalMs: number;
			lastSummary: TickSummary | null;
		};
		agents: Array<{
			id: string;
			status: "active" | "paused" | "liquidated";
			currentCash: number;
			currentNav: number;
			positions: PersistedPositionRecord | null;
			realizedPnl: Record<string, number> | null;
			lastAutopilotDirective: AutopilotDirective | null;
			llmGroup: number;
		}>;
		openOrders: Array<{
			id: string;
			tick: number;
			agentId: string;
			symbol: string;
			type: "market" | "limit";
			side: "buy" | "sell";
			status: OrderStatus;
			price: number | null;
			quantity: number;
			filledQuantity: number;
			llmReasoning: string | null;
		}>;
		researchNotes: ResearchNote[];
		agentEventCount: number;
	};
}

export interface RestoreSimulationResult extends BootstrapSimulationResult {
	runtimeState: {
		isRunning: boolean;
		currentTick: number;
		simulatedMarketTime: Date | null;
		speedMultiplier: number;
		tickIntervalMs: number;
		lastSummary: TickSummary | null;
		nextAgentEventSequence: number;
	};
	researchNotes: ResearchNote[];
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
		shuffle<T>(items: readonly T[]): T[] {
			const result = [...items];
			for (let index = result.length - 1; index > 0; index -= 1) {
				const swapIndex = this.int(0, index);
				[result[index], result[swapIndex]] = [result[swapIndex], result[index]];
			}
			return result;
		},
	};
}

function hashString(value: string): number {
	let hash = 2166136261;

	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}

function namespacedId(sessionId: string, value: string): string {
	return `${sessionId}:${value}`;
}

function namespaceAgentConfigs(
	configs: AgentConfig[],
	sessionId: string,
): AgentConfig[] {
	return configs.map((config) => ({
		...config,
		id: namespacedId(sessionId, config.id),
	}));
}

function namespaceResearchWorkers(
	workers: ResearchAgentWorker[],
	sessionId: string,
): ResearchAgentWorker[] {
	return workers.map((worker) => {
		const requestContext = cloneResearchRequestContext(worker.requestContext);
		const id = namespacedId(sessionId, worker.id);
		requestContext.set("agent-id", id);
		requestContext.set("simulation-session-id", sessionId);

		return {
			...worker,
			id,
			requestContext,
		};
	});
}

function applySimulationSessionContext(
	agentRegistry: AgentRegistry,
	sessionId: string,
): void {
	for (const entry of agentRegistry.getAll()) {
		entry.requestContext.set("simulation-session-id", sessionId);
	}
}

function buildSimulationActors(input: {
	sessionId: string;
	seed: number;
	agentCount: number;
	groupCount: number;
	traderDistribution: TraderDistribution;
}): {
	agentRegistry: AgentRegistry;
	researchWorkers: ResearchAgentWorker[];
	seedAgentId: string;
} {
	const agentConfigs = namespaceAgentConfigs(
		generateAgentConfigs(input.seed, input.agentCount, {
			groupCount: input.groupCount,
			traderDistribution: input.traderDistribution,
		}),
		input.sessionId,
	);
	const agentRegistry = spawnAgents(agentConfigs, input.groupCount);
	applySimulationSessionContext(agentRegistry, input.sessionId);

	return {
		agentRegistry,
		researchWorkers: namespaceResearchWorkers(
			spawnResearchAgents(),
			input.sessionId,
		),
		seedAgentId: namespacedId(input.sessionId, "market-maker-seed"),
	};
}

function deserializePositions(
	positions: PersistedPositionRecord | null | undefined,
): Map<string, Position> {
	return new Map(
		Object.entries(positions ?? {}).map(([symbol, position]) => [
			symbol,
			{
				qty: position.qty,
				avgCost: new Decimal(position.avgCost),
			},
		]),
	);
}

function deserializeRealizedPnl(
	realizedPnl: Record<string, number> | null | undefined,
): Map<string, Decimal> {
	return new Map(
		Object.entries(realizedPnl ?? {}).map(([symbol, pnl]) => [
			symbol,
			new Decimal(pnl),
		]),
	);
}

function deserializeOrder(input: {
	id: string;
	tick: number;
	agentId: string;
	symbol: string;
	type: "market" | "limit";
	side: "buy" | "sell";
	status: OrderStatus;
	price: number | null;
	quantity: number;
	filledQuantity: number;
	llmReasoning: string | null;
}): Order {
	return {
		id: input.id,
		symbol: input.symbol,
		side: input.side,
		type: input.type,
		price: new Decimal(input.price ?? 0),
		qty: input.quantity,
		filledQty: input.filledQuantity,
		status: input.status,
		agentId: input.agentId,
		llmReasoning: input.llmReasoning ?? undefined,
		createdAtTick: input.tick,
	};
}

function deserializeTrade(input: {
	id: string;
	buyOrderId: string;
	sellOrderId: string;
	buyerAgentId: string;
	sellerAgentId: string;
	symbol: string;
	price: Decimal.Value;
	qty: number;
	tick: number;
}): Trade {
	return {
		id: input.id,
		buyOrderId: input.buyOrderId,
		sellOrderId: input.sellOrderId,
		buyerAgentId: input.buyerAgentId,
		sellerAgentId: input.sellerAgentId,
		symbol: input.symbol,
		price:
			input.price instanceof Decimal ? input.price : new Decimal(input.price),
		qty: input.qty,
		tick: input.tick,
	};
}

function deserializeTickSummary(
	summary: TickSummary | null | undefined,
): TickSummary | null {
	if (!summary) {
		return null;
	}

	return {
		...summary,
		simulatedTime: new Date(summary.simulatedTime),
		trades: (summary.trades ?? []).map((trade) => deserializeTrade(trade)),
	};
}

function getSymbolSector(symbol: string): Sector | null {
	return DEV_TICKERS.find((ticker) => ticker.symbol === symbol)?.sector ?? null;
}

function resolveSeedMidPrice(
	symbol: string,
	marketData?: BootstrapMarketData | null,
): Decimal {
	const quote = marketData?.symbols[symbol];
	return new Decimal(quote?.midPrice ?? quote?.lastPrice ?? DEFAULT_SEED_PRICE);
}

function resolveSeedSpread(
	symbol: string,
	marketData?: BootstrapMarketData | null,
): Decimal {
	const quote = marketData?.symbols[symbol];
	const spread = new Decimal(quote?.spread ?? DEFAULT_SEED_SPREAD);
	return Decimal.max(spread, MIN_SPREAD);
}

function resolveHistoricalTick(
	symbols: string[],
	marketData?: BootstrapMarketData | null,
): number {
	return Math.max(
		0,
		...symbols.map((symbol) => marketData?.symbols[symbol]?.bars.length ?? 0),
	);
}

function buildBootstrapBars(input: {
	sessionId: string;
	symbols: string[];
	historicalTickCount: number;
	marketData?: BootstrapMarketData | null;
}) {
	if (!input.marketData || input.historicalTickCount === 0) {
		return [];
	}

	return input.symbols.flatMap((symbol) => {
		const bars = input.marketData?.symbols[symbol]?.bars ?? [];
		const offset = input.historicalTickCount - bars.length;

		return bars.map((bar, index) => ({
			sessionId: input.sessionId,
			tick: offset + index + 1,
			symbol,
			open: bar.open,
			high: bar.high,
			low: bar.low,
			close: bar.close,
			volume: bar.volume,
		}));
	});
}

function selectPortfolioSymbols(input: {
	config: AgentConfig;
	symbols: string[];
	rng: SeededRandom;
}): string[] {
	const restricted = new Set(input.config.restrictedSymbols);
	const bySector = input.symbols.filter((symbol) => {
		const sector = getSymbolSector(symbol);
		return (
			sector !== null &&
			input.config.sectors.includes(sector) &&
			!restricted.has(symbol)
		);
	});
	const fallback = input.symbols.filter((symbol) => !restricted.has(symbol));
	const pool = bySector.length > 0 ? bySector : fallback;

	if (pool.length === 0) {
		return [];
	}

	let targetCount =
		input.config.tier === "tier1" ? 5 : input.config.tier === "tier2" ? 4 : 2;
	if (input.config.entityType.includes("market-maker")) {
		targetCount =
			input.config.tier === "tier1" ? 6 : input.config.tier === "tier2" ? 5 : 3;
	} else if (input.config.entityType.includes("pension")) {
		targetCount = input.config.tier === "tier1" ? 5 : 4;
	} else if (input.config.strategy.includes("depth-provider")) {
		targetCount = 3;
	} else if (input.config.strategy.includes("value")) {
		targetCount = 3;
	}

	return input.rng.shuffle(pool).slice(0, Math.min(targetCount, pool.length));
}

function resolveInvestedCapitalRatio(
	config: AgentConfig,
	rng: SeededRandom,
): number {
	if (
		config.entityType.includes("market-maker") ||
		config.strategy.includes("depth-provider")
	) {
		return Number(rng.float(0.15, 0.3).toFixed(4));
	}

	if (config.entityType.includes("pension")) {
		return Number(rng.float(0.72, 0.88).toFixed(4));
	}

	if (config.tier === "tier1") {
		return Number(rng.float(0.62, 0.82).toFixed(4));
	}

	if (config.tier === "tier2") {
		return Number(rng.float(0.55, 0.78).toFixed(4));
	}

	if (config.strategy.includes("value")) {
		return Number(rng.float(0.65, 0.85).toFixed(4));
	}

	if (config.strategy.includes("noise")) {
		return Number(rng.float(0.35, 0.58).toFixed(4));
	}

	return Number(rng.float(0.42, 0.68).toFixed(4));
}

function buildAutopilotDirective(input: {
	config: AgentConfig;
	symbols: string[];
	priceBySymbol: Map<string, Decimal>;
	rng: SeededRandom;
	positionSymbols?: string[];
}) {
	const selectedSymbols = selectPortfolioSymbols({
		config: input.config,
		symbols: input.symbols,
		rng: input.rng,
	});
	const side =
		input.config.strategy.includes("value") ||
		input.config.entityType.includes("pension")
			? ("buy" as const)
			: input.config.strategy.includes("momentum")
				? ("buy" as const)
				: input.config.id.charCodeAt(input.config.id.length - 1) % 2 === 0
					? ("buy" as const)
					: ("sell" as const);

	const standingOrders = selectedSymbols.slice(0, 2).map((symbol) => {
		const referencePrice =
			input.priceBySymbol.get(symbol) ?? DEFAULT_SEED_PRICE;
		const price =
			side === "buy"
				? referencePrice.mul("0.9985")
				: referencePrice.mul("1.0015");

		return {
			symbol,
			side,
			type: "limit" as const,
			price: Number(price.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()),
			qty: Math.max(1, Math.floor(5 + input.config.capital / 100000)),
		};
	});

	const heldSymbols = input.positionSymbols ?? [];
	const sideSymbols = new Set(selectedSymbols.slice(0, 2));
	for (const symbol of heldSymbols.slice(0, 2)) {
		if (sideSymbols.has(symbol)) continue;
		const referencePrice =
			input.priceBySymbol.get(symbol) ?? DEFAULT_SEED_PRICE;
		standingOrders.push({
			symbol,
			side: "sell",
			type: "limit",
			price: Number(
				referencePrice
					.mul("1.05")
					.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
					.toString(),
			),
			qty: Math.max(1, Math.floor(3 + input.config.capital / 150000)),
		});
	}

	return {
		standingOrders,
		holdPositions: [],
	};
}

function seedAgentPortfolio(input: {
	config: AgentConfig;
	symbols: string[];
	priceBySymbol: Map<string, Decimal>;
}): {
	cash: Decimal;
	nav: Decimal;
	positions: Map<string, Position>;
} {
	const rng = createSeededRandom(hashString(input.config.id));
	const selectedSymbols = selectPortfolioSymbols({
		config: input.config,
		symbols: input.symbols,
		rng,
	});

	if (selectedSymbols.length === 0) {
		return {
			cash: new Decimal(input.config.capital),
			nav: new Decimal(input.config.capital),
			positions: new Map(),
		};
	}

	const investableCapital = new Decimal(input.config.capital).mul(
		resolveInvestedCapitalRatio(input.config, rng),
	);
	const rawWeights = selectedSymbols.map((symbol, index) => {
		const sector = getSymbolSector(symbol);
		const sectorBoost =
			sector !== null && input.config.sectors.includes(sector) ? 1.15 : 1;
		const orderDecay = Math.max(0.7, 1 - index * 0.1);
		const jitter = rng.float(0.9, 1.1);
		return sectorBoost * orderDecay * jitter;
	});
	const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
	const positions = new Map<string, Position>();
	let spent = new Decimal(0);

	for (const [index, symbol] of selectedSymbols.entries()) {
		const price = input.priceBySymbol.get(symbol);
		if (!price || !price.isFinite() || price.lte(0)) {
			continue;
		}

		const targetValue = investableCapital.mul(rawWeights[index] / totalWeight);
		const qty = Math.floor(targetValue.div(price).toNumber());
		if (qty <= 0) {
			continue;
		}

		const positionValue = price.mul(qty);
		spent = spent.plus(positionValue);
		positions.set(symbol, {
			qty,
			avgCost: price,
		});
	}

	const cash = Decimal.max(new Decimal(input.config.capital).minus(spent), 0);
	const markedValue = Array.from(positions.entries()).reduce(
		(total, [symbol, position]) =>
			total.plus(
				(input.priceBySymbol.get(symbol) ?? position.avgCost).mul(position.qty),
			),
		new Decimal(0),
	);

	return {
		cash,
		nav: cash.plus(markedValue),
		positions,
	};
}

function seedAgentState(input: {
	agentRegistry: AgentRegistry;
	symbols: string[];
	priceBySymbol: Map<string, Decimal>;
}): void {
	for (const entry of input.agentRegistry.getAll()) {
		const seeded = seedAgentPortfolio({
			config: entry.config,
			symbols: input.symbols,
			priceBySymbol: input.priceBySymbol,
		});
		const directiveRng = createSeededRandom(
			hashString(`${entry.config.id}:directive`),
		);

		input.agentRegistry.updateState(entry.config.id, {
			cash: seeded.cash,
			nav: seeded.nav,
			positions: seeded.positions,
			lastAutopilotDirective: buildAutopilotDirective({
				config: entry.config,
				symbols: input.symbols,
				priceBySymbol: input.priceBySymbol,
				rng: directiveRng,
				positionSymbols: Array.from(seeded.positions.keys()),
			}),
		});
	}
}

export async function bootstrapSimulation(
	input: BootstrapSimulationInput,
): Promise<BootstrapSimulationResult> {
	const matchingEngine = new MatchingEngine();
	matchingEngine.initialize(input.symbols);

	const historicalTickCount = resolveHistoricalTick(
		input.symbols,
		input.marketData,
	);
	const { agentRegistry, researchWorkers, seedAgentId } = buildSimulationActors(
		{
			sessionId: input.sessionId,
			seed: input.seed,
			agentCount: input.agentCount,
			groupCount: input.groupCount,
			traderDistribution: input.traderDistribution,
		},
	);
	const priceBySymbol = new Map(
		input.symbols.map((symbol) => [
			symbol,
			resolveSeedMidPrice(symbol, input.marketData),
		]),
	);
	const seedOrders: Order[] = [];

	for (const symbol of input.symbols) {
		seedOrders.push(
			...matchingEngine.seedBook(
				symbol,
				resolveSeedMidPrice(symbol, input.marketData),
				resolveSeedSpread(symbol, input.marketData),
				DEFAULT_BOOK_DEPTH,
				DEFAULT_BOOK_QTY,
				historicalTickCount,
			),
		);
	}

	for (const order of seedOrders) {
		order.agentId = seedAgentId;
	}

	seedAgentState({
		agentRegistry,
		symbols: input.symbols,
		priceBySymbol,
	});
	const agentRows = serializeAgentEntriesForDb(
		agentRegistry.getAll(),
		input.sessionId,
	);
	const researchRows = researchWorkers.map((worker) => ({
		sessionId: input.sessionId,
		id: worker.id,
		name: worker.name,
		tier: "research" as const,
		status: "active" as const,
		entityType: "research-desk",
		strategyType: worker.focus,
		persona: worker.persona,
		riskTolerance: 0,
		startingCapital: 0,
		currentCash: 0,
		currentNav: 0,
		positions: {},
		parameters: {},
		llmGroup: 0,
	}));
	const initialSnapshots = input.symbols.map((symbol) =>
		serializeOrderBookSnapshot({
			sessionId: input.sessionId,
			snapshot: matchingEngine.getSnapshot(symbol),
			tick: historicalTickCount,
		}),
	);
	const bootstrapBars = buildBootstrapBars({
		sessionId: input.sessionId,
		symbols: input.symbols,
		historicalTickCount,
		marketData: input.marketData,
	});
	const initialSimulatedTime = new SimClock(input.simulatedTickDuration, {
		initialTick: historicalTickCount,
	}).simulatedTime;

	await db.transaction(async (tx) => {
		await tx.insert(agentsTable).values([
			{
				sessionId: input.sessionId,
				id: seedAgentId,
				name: "Seed Liquidity Provider",
				tier: "tier3",
				status: "active",
				entityType: "market-maker",
				strategyType: "depth-provider",
				riskTolerance: 0,
				startingCapital: 0,
				currentCash: 0,
				currentNav: 0,
				positions: {},
				parameters: {},
				llmGroup: 0,
			},
			...researchRows,
			...agentRows,
		]);

		if (seedOrders.length > 0) {
			await tx.insert(ordersTable).values(
				seedOrders.map((order) => ({
					id: order.id,
					sessionId: input.sessionId,
					tick: order.createdAtTick,
					agentId: order.agentId,
					symbol: order.symbol,
					type: order.type,
					side: order.side,
					status: order.status,
					price: order.price.toNumber(),
					quantity: order.qty,
					filledQuantity: order.filledQty,
				})),
			);
		}

		if (bootstrapBars.length > 0) {
			await tx.insert(ticksTable).values(bootstrapBars);
		}

		await tx.insert(orderBookSnapshotsTable).values(initialSnapshots);
		await tx.insert(simConfigTable).values({
			sessionId: input.sessionId,
			isRunning: false,
			currentTick: historicalTickCount,
			simulatedMarketTime: initialSimulatedTime,
			speedMultiplier: 1,
			tickIntervalMs: input.tickIntervalMs,
			lastSummary: null,
			seed: input.seed,
		});
	});

	return {
		sessionId: input.sessionId,
		symbols: input.symbols,
		initialTick: historicalTickCount,
		matchingEngine,
		agentRegistry,
		researchWorkers,
	};
}

export function restoreSimulation(
	input: RestoreSimulationInput,
): RestoreSimulationResult {
	const matchingEngine = new MatchingEngine();
	matchingEngine.initialize(input.symbols);

	const { agentRegistry, researchWorkers } = buildSimulationActors({
		sessionId: input.sessionId,
		seed: input.seed,
		agentCount: input.agentCount,
		groupCount: input.groupCount,
		traderDistribution: input.traderDistribution,
	});

	const persistedAgentsById = new Map(
		input.persistedState.agents.map((agent) => [agent.id, agent]),
	);

	for (const entry of agentRegistry.getAll()) {
		const persisted = persistedAgentsById.get(entry.config.id);
		if (!persisted) {
			continue;
		}

		entry.config.llmGroup = persisted.llmGroup;
		entry.requestContext.set("llm-group", persisted.llmGroup);
		agentRegistry.updateState(entry.config.id, {
			status: persisted.status,
			llmGroup: persisted.llmGroup,
			cash: new Decimal(persisted.currentCash),
			nav: new Decimal(persisted.currentNav),
			positions: deserializePositions(persisted.positions),
			realizedPnl: deserializeRealizedPnl(persisted.realizedPnl),
			lastAutopilotDirective:
				persisted.lastAutopilotDirective ?? entry.state.lastAutopilotDirective,
		});
	}

	const openOrdersByAgentId = new Map<string, Map<string, Order>>();

	for (const persistedOrder of input.persistedState.openOrders) {
		const order = deserializeOrder(persistedOrder);
		const replayedTrades = matchingEngine.processOrder(
			order,
			persistedOrder.tick,
		);
		if (replayedTrades.length > 0) {
			console.warn(
				`[Bootstrap] Replay for session ${input.sessionId} order ${order.id} produced ${replayedTrades.length} trades while rebuilding the live book.`,
			);
		}

		if (!agentRegistry.get(order.agentId)) {
			continue;
		}

		const openOrders =
			openOrdersByAgentId.get(order.agentId) ?? new Map<string, Order>();
		openOrders.set(order.id, order);
		openOrdersByAgentId.set(order.agentId, openOrders);
	}

	for (const entry of agentRegistry.getAll()) {
		agentRegistry.updateState(entry.config.id, {
			openOrders:
				openOrdersByAgentId.get(entry.config.id) ?? new Map<string, Order>(),
		});
	}

	return {
		sessionId: input.sessionId,
		symbols: input.symbols,
		initialTick: input.persistedState.simConfig.currentTick,
		matchingEngine,
		agentRegistry,
		researchWorkers,
		runtimeState: {
			isRunning: input.persistedState.simConfig.isRunning,
			currentTick: input.persistedState.simConfig.currentTick,
			simulatedMarketTime: input.persistedState.simConfig.simulatedMarketTime,
			speedMultiplier: input.persistedState.simConfig.speedMultiplier,
			tickIntervalMs: input.persistedState.simConfig.tickIntervalMs,
			lastSummary: deserializeTickSummary(
				input.persistedState.simConfig.lastSummary,
			),
			nextAgentEventSequence: input.persistedState.agentEventCount,
		},
		researchNotes: [...input.persistedState.researchNotes],
	};
}
