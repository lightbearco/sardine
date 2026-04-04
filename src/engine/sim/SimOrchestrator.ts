import { asc, eq, type InferSelectModel } from "drizzle-orm";
import Decimal from "decimal.js";
import pLimit from "p-limit";
import { PortfolioManager } from "#/agents/PortfolioManager";
import type { AgentRegistry, AgentRegistryEntry } from "#/agents/AgentRegistry";
import { partitionAgentEntries, getActiveGroupIndex } from "#/agents/batch-scheduler";
import { executeAutopilot } from "#/agents/autopilot";
import { serializeAgentEntryForDb } from "#/agents/persistence";
import type { Database } from "#/db";
import {
	agents as agentsTable,
	commands as commandsTable,
	orders as ordersTable,
	simConfig as simConfigTable,
	ticks as ticksTable,
	trades as tradesTable,
	worldEvents as worldEventsTable,
} from "#/db/schema";
import type { EventBus } from "#/engine/bus/EventBus";
import type { PublicationBus } from "#/engine/bus/PublicationBus";
import type { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SIM_DEFAULTS } from "#/lib/constants";
import {
	cloneTradingRequestContext,
	type TradingRequestContextValues,
} from "#/mastra/trading-context";
import {
	tradingDecisionSchema,
	type TradingDecision,
} from "#/mastra/agents/trading-agent";
import { getGoogleGeminiProvider } from "#/mastra/google-gemini";
import type { Order, OHLCVBar, Trade } from "#/types/market";
import type { ResearchNote } from "#/types/research";
import type {
	AgentSignal,
	InjectWorldEventCommand,
	ParsedSimCommand,
	SimCommandType,
	SimConfig,
	SimOrchestratorState,
	StagedOrderResult,
	TickSummary,
	WorldEvent,
} from "#/types/sim";
import {
	simCommandPayloadSchemaByType,
	simCommandTypeSchema,
} from "#/types/sim";
import type { SimClock } from "./SimClock";

const DEFAULT_LLM_CONCURRENCY = 10;
const DEFAULT_LLM_TIMEOUT_MS = 15_000;
const SIM_CONFIG_ROW_ID = 1;

type CommandRow = InferSelectModel<typeof commandsTable>;
type TradingAgentLike = {
	generate(
		prompt: string,
		options: Record<string, unknown>,
	): Promise<{ object: unknown }>;
};

interface CommandUpdate {
	id: number;
	status: "processed" | "rejected";
	resultMessage: string;
}

interface ActiveAgentOutcome {
	stagedOrders: StagedOrderResult[];
	signalEvents: AgentSignal[];
}

export class SimOrchestrator {
	private readonly portfolioManager = new PortfolioManager();
	private readonly llmConcurrency: number;
	private readonly llmTimeoutMs: number;
	private readonly groupCount: number;
	private isRunning = false;
	private isTicking = false;
	private lastSummary: TickSummary | null = null;
	private speedMultiplier = 1;
	private tickIntervalMs = SIM_DEFAULTS.tickIntervalMs;

	constructor(
		private readonly matchingEngine: MatchingEngine,
		private readonly agentRegistry: AgentRegistry,
		private readonly simClock: SimClock,
		private readonly publicationBus: PublicationBus,
		private readonly eventBus: EventBus,
		private readonly db: Database,
		private readonly tradingAgent: TradingAgentLike,
		options: {
			llmConcurrency?: number;
			llmTimeoutMs?: number;
			groupCount?: number;
		} = {},
	) {
		this.llmConcurrency = options.llmConcurrency ?? DEFAULT_LLM_CONCURRENCY;
		this.llmTimeoutMs = options.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
		this.groupCount = options.groupCount ?? SIM_DEFAULTS.groupCount;
	}

	async start(): Promise<void> {
		this.isRunning = true;
		await this.persistSimConfig();
	}

	async stop(): Promise<void> {
		this.isRunning = false;
		await this.persistSimConfig();
	}

	async step(): Promise<TickSummary> {
		return this.tick();
	}

	/**
	 * Process only control commands (start/pause/speed/interval) without running a full tick.
	 * Used by the sim-runner when paused so that "start" commands can resume the simulation.
	 * Returns true if any commands were processed.
	 */
	async processControlCommands(): Promise<boolean> {
		const pendingCommands = await this.loadPendingCommands();
		if (pendingCommands.length === 0) return false;

		const { commandUpdates } = this.processPendingCommands(
			pendingCommands,
			this.simClock.simTick,
		);

		if (commandUpdates.length > 0) {
			await this.db.transaction(async (tx) => {
				for (const commandUpdate of commandUpdates) {
					await tx
						.update(commandsTable)
						.set({
							status: commandUpdate.status,
							resultMessage: commandUpdate.resultMessage,
							processedAt: new Date(),
						})
						.where(eq(commandsTable.id, commandUpdate.id));
				}
			});
		}

		return commandUpdates.length > 0;
	}

	getState(): SimOrchestratorState {
		return {
			isRunning: this.isRunning,
			isTicking: this.isTicking,
			simTick: this.simClock.simTick,
			simulatedTime: new Date(this.simClock.simulatedTime),
			activeGroupIndex: getActiveGroupIndex(this.simClock.simTick, this.groupCount),
			lastSummary: this.lastSummary,
		};
	}

	async tick(): Promise<TickSummary> {
		if (this.isTicking) {
			throw new Error("SimOrchestrator is already processing a tick");
		}

		const tickStartedAt = Date.now();
		this.isTicking = true;

		try {
			this.simClock.advance();
			const simTick = this.simClock.simTick;
			const simulatedTime = new Date(this.simClock.simulatedTime);
			const changedAgentIds = new Set<string>();
			const touchedSymbols = new Set<string>();

			const pendingCommands = await this.loadPendingCommands();
			const { commandUpdates, appliedWorldEvents } =
				this.processPendingCommands(pendingCommands, simTick);

			const releasedNotes = this.publicationBus.releaseDue(simTick);
			this.deliverReleasedResearch(releasedNotes, changedAgentIds);

			const { active, inactive } = partitionAgentEntries(
				this.agentRegistry,
				simTick,
				this.groupCount,
			);

			const preMatchReferencePrices = this.matchingEngine.getReferencePrices();
			const autopilotPriceMap = new Map(
				Array.from(preMatchReferencePrices.entries(), ([symbol, price]) => [
					symbol,
					price.toNumber(),
				]),
			);

			const stagedOrders: StagedOrderResult[] = [];

			for (const entry of inactive) {
				const autopilotResult = executeAutopilot(
					entry.state,
					autopilotPriceMap,
					simTick,
				);

				if (
					autopilotResult.cancelOrderIds.length > 0 ||
					autopilotResult.orders.length > 0
				) {
					changedAgentIds.add(entry.config.id);
				}

				for (const cancelOrderId of autopilotResult.cancelOrderIds) {
					const existingOrder = entry.state.openOrders.get(cancelOrderId);
					if (!existingOrder) {
						continue;
					}

					this.matchingEngine.cancelOrder(cancelOrderId, existingOrder.symbol);
					entry.state.openOrders.delete(cancelOrderId);
					touchedSymbols.add(existingOrder.symbol);
				}

				for (const order of autopilotResult.orders) {
					stagedOrders.push({
						order,
						source: "autopilot",
						agentName: entry.config.name,
						reasoning: null,
					});
					touchedSymbols.add(order.symbol);
				}
			}

			const activeOutcome = await this.runActiveAgents(
				active,
				simTick,
				simulatedTime,
				changedAgentIds,
			);

			stagedOrders.push(...activeOutcome.stagedOrders);
			for (const stagedOrder of activeOutcome.stagedOrders) {
				touchedSymbols.add(stagedOrder.order.symbol);
			}

			const trades = this.matchingEngine.processOrders(
				stagedOrders.map((stagedOrder) => stagedOrder.order),
				simTick,
			);

			for (const trade of trades) {
				changedAgentIds.add(trade.buyerAgentId);
				changedAgentIds.add(trade.sellerAgentId);
				touchedSymbols.add(trade.symbol);
			}

			for (const stagedOrder of stagedOrders) {
				this.syncOrderState(stagedOrder.order, changedAgentIds);
			}

			for (const agentId of changedAgentIds) {
				const entry = this.agentRegistry.get(agentId);
				if (!entry) {
					continue;
				}

				this.agentRegistry.updateState(agentId, {
					openOrders: new Map(entry.state.openOrders),
				});
			}

			const postMatchReferencePrices = this.matchingEngine.getReferencePrices();
			this.portfolioManager.reconcile(
				trades,
				this.agentRegistry,
				postMatchReferencePrices,
			);

			const bars = this.computeOhlcvBars(trades);
			await this.persistTick(
				stagedOrders,
				trades,
				bars,
				commandUpdates,
				appliedWorldEvents,
				changedAgentIds,
				simulatedTime,
			);

			for (const stagedOrder of stagedOrders) {
				this.eventBus.emit("order", stagedOrder.order);
			}

			for (const trade of trades) {
				this.eventBus.emit("trade", trade);
			}

			for (const symbol of touchedSymbols) {
				this.eventBus.emit("lob-update", this.matchingEngine.getSnapshot(symbol));
			}

			for (const bar of bars) {
				this.eventBus.emit("ohlcv", bar);
			}

			for (const signal of activeOutcome.signalEvents) {
				this.eventBus.emit("agent-signal", signal);
			}

			for (const event of appliedWorldEvents) {
				this.eventBus.emit("world-event", event);
			}

			const summary: TickSummary = {
				durationMs: Date.now() - tickStartedAt,
				orderCount: stagedOrders.length,
				tradeCount: trades.length,
				activeAgents: active.length,
				simTick,
				simulatedTime,
				trades,
				isRunning: this.isRunning,
			};

			this.lastSummary = summary;
			this.eventBus.emit("tick", { simTick, simulatedTime });
			this.eventBus.emit("sim-state", {
				...this.buildSimConfig(active.length),
				tickDurationMs: summary.durationMs,
			});

			return summary;
		} finally {
			this.isTicking = false;
		}
	}

	private async runActiveAgents(
		activeEntries: AgentRegistryEntry[],
		simTick: number,
		simulatedTime: Date,
		changedAgentIds: Set<string>,
	): Promise<ActiveAgentOutcome> {
		const limit = pLimit(this.llmConcurrency);
		const tasks = activeEntries.map((entry) =>
			limit(() => this.generateForActiveAgent(entry, simTick, simulatedTime)),
		);
		const settledResults = await Promise.allSettled(tasks);
		const stagedOrders: StagedOrderResult[] = [];
		const signalEvents: AgentSignal[] = [];

		for (const [index, settled] of settledResults.entries()) {
			const entry = activeEntries[index];

			if (settled.status === "fulfilled") {
				entry.state.lastAutopilotDirective = settled.value.decision.autopilotDirective;
				entry.state.lastLlmTick = simTick;
				changedAgentIds.add(entry.config.id);
				stagedOrders.push(...settled.value.orders);
				signalEvents.push(...settled.value.signals);
				continue;
			}

			entry.state.lastAutopilotDirective = this.buildFallbackDirective(entry);
			entry.state.lastLlmTick = simTick;
			changedAgentIds.add(entry.config.id);
		}

		return { stagedOrders, signalEvents };
	}

	private async generateForActiveAgent(
		entry: AgentRegistryEntry,
		simTick: number,
		simulatedTime: Date,
	): Promise<{
		decision: TradingDecision;
		orders: StagedOrderResult[];
		signals: AgentSignal[];
	}> {
		const requestContext = cloneTradingRequestContext(
			entry.requestContext as unknown as RequestContext<TradingRequestContextValues>
		);
		requestContext.set("agent-registry", this.agentRegistry);
		requestContext.set("matching-engine", this.matchingEngine);
		requestContext.set("sim-tick", simTick);
		requestContext.set(
			"released-research-notes",
			this.getReleasedNotesForAgent(entry),
		);

		const result = await this.generateWithTimeout(
			this.buildTickPrompt(entry, simTick, simulatedTime),
			requestContext,
		);
		const decision = tradingDecisionSchema.parse(result.object);

		const orders = decision.ordersPlaced.map((placedOrder) => ({
			order: {
				id: placedOrder.orderId,
				symbol: placedOrder.symbol,
				side: placedOrder.side,
				type: placedOrder.type,
				price: new Decimal(placedOrder.price),
				qty: placedOrder.qty,
				filledQty: placedOrder.filledQty,
				status: "pending" as const,
				agentId: entry.config.id,
				llmReasoning: decision.reasoning,
				createdAtTick: simTick,
			},
			source: "llm" as const,
			agentName: entry.config.name,
			reasoning: decision.reasoning,
		}));
		const signals = orders.map(({ order, reasoning }) => ({
			agentId: entry.config.id,
			agentName: entry.config.name,
			side: order.side,
			symbol: order.symbol,
			price: order.type === "market" ? 0 : order.price.toNumber(),
			qty: order.qty,
			reasoning,
			tick: simTick,
		}));

		return { decision, orders, signals };
	}

	private async generateWithTimeout(
		prompt: string,
		requestContext: ReturnType<typeof cloneTradingRequestContext>,
	): Promise<{ object: unknown }> {
		const controller = new AbortController();
		const timeoutHandle = setTimeout(() => {
			controller.abort("LLM generation timed out");
		}, this.llmTimeoutMs);

		try {
			return await this.tradingAgent.generate(prompt, {
				requestContext,
				maxSteps: 6,
				abortSignal: controller.signal,
				structuredOutput: {
					schema: tradingDecisionSchema,
					model: this.resolveStructuredOutputModel(
						requestContext.get("model-tier"),
					),
				},
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new Error("LLM generation timed out");
			}

			throw error;
		} finally {
			clearTimeout(timeoutHandle);
		}
	}

	private resolveStructuredOutputModel(modelTier: "sonnet" | "haiku" | undefined) {
		const googleProvider = getGoogleGeminiProvider();
		return modelTier === "sonnet"
			? googleProvider("gemini-2.5-pro")
			: googleProvider("gemini-2.5-flash");
	}

	private syncOrderState(order: Order, changedAgentIds: Set<string>): void {
		const entry = this.agentRegistry.get(order.agentId);
		if (!entry) {
			return;
		}

		if (
			order.type === "limit" &&
			(order.status === "open" || order.status === "partial")
		) {
			entry.state.openOrders.set(order.id, order);
		} else {
			entry.state.openOrders.delete(order.id);
		}

		changedAgentIds.add(order.agentId);
	}

	private deliverReleasedResearch(
		releasedNotes: ReturnType<PublicationBus["releaseDue"]>,
		changedAgentIds: Set<string>,
	): void {
		const notesByTier = {
			tier1: releasedNotes.tier1,
			tier2: releasedNotes.tier2,
			tier3: releasedNotes.tier3,
		} as const;

		for (const entry of this.agentRegistry.getAll()) {
			if (
				entry.state.tier !== "tier1" &&
				entry.state.tier !== "tier2" &&
				entry.state.tier !== "tier3"
			) {
				continue;
			}

			const tierNotes = notesByTier[entry.state.tier];
			let inboxChanged = false;

			for (const note of tierNotes) {
				if (entry.state.researchInbox.has(note.id)) {
					continue;
				}

				entry.state.researchInbox.set(note.id, {
					...note,
					releasedToTier: entry.state.tier,
				});
				inboxChanged = true;
			}

			if (inboxChanged) {
				changedAgentIds.add(entry.config.id);
			}
		}
	}

	private getReleasedNotesForAgent(entry: AgentRegistryEntry): ResearchNote[] {
		return Array.from(entry.state.researchInbox.values()).sort(
			(left, right) => right.publishedAtTick - left.publishedAtTick,
		);
	}

	private buildTickPrompt(
		entry: AgentRegistryEntry,
		simTick: number,
		simulatedTime: Date,
	): string {
		const notes = this.getReleasedNotesForAgent(entry).slice(0, 3);
		const noteSummary =
			notes.length === 0
				? "No new research notes were released to you this tick."
				: notes
						.map(
							(note) =>
								`- ${note.headline} (${note.sentiment}, confidence ${note.confidence}) on ${note.symbols.join(", ")}`,
						)
						.join("\n");

		return [
			`Simulation tick: ${simTick}`,
			`Simulated market time: ${simulatedTime.toISOString()}`,
			"Recent released research:",
			noteSummary,
			"Decide whether to trade this tick. Use tools when you need market data, portfolio context, or to stage an order.",
		].join("\n\n");
	}

	private buildFallbackDirective(entry: AgentRegistryEntry): TradingDecision["autopilotDirective"] {
		return {
			standingOrders: [],
			holdPositions: Array.from(entry.state.positions.keys()),
		};
	}

	private computeOhlcvBars(trades: Trade[]): OHLCVBar[] {
		const bars = new Map<string, OHLCVBar>();

		for (const trade of trades) {
			const existingBar = bars.get(trade.symbol);

			if (!existingBar) {
				bars.set(trade.symbol, {
					symbol: trade.symbol,
					open: trade.price,
					high: trade.price,
					low: trade.price,
					close: trade.price,
					volume: trade.qty,
					tick: trade.tick,
				});
				continue;
			}

			existingBar.high = Decimal.max(existingBar.high, trade.price);
			existingBar.low = Decimal.min(existingBar.low, trade.price);
			existingBar.close = trade.price;
			existingBar.volume += trade.qty;
		}

		return Array.from(bars.values());
	}

	private async loadPendingCommands(): Promise<CommandRow[]> {
		return this.db
			.select()
			.from(commandsTable)
			.where(eq(commandsTable.status, "pending"))
			.orderBy(asc(commandsTable.id));
	}

	private processPendingCommands(
		pendingCommands: CommandRow[],
		simTick: number,
	): {
		commandUpdates: CommandUpdate[];
		appliedWorldEvents: WorldEvent[];
	} {
		const commandUpdates: CommandUpdate[] = [];
		const appliedWorldEvents: WorldEvent[] = [];

		for (const command of pendingCommands) {
			try {
				const parsedCommand = this.parseCommand(command);

				switch (parsedCommand.type) {
					case "inject_world_event": {
						const worldEvent = this.createWorldEvent(
							parsedCommand as ParsedSimCommand<"inject_world_event">,
							simTick,
						);
						appliedWorldEvents.push(worldEvent);
						commandUpdates.push({
							id: command.id,
							status: "processed",
							resultMessage: `Applied world event ${worldEvent.id}`,
						});
						break;
					}
					case "start":
						this.isRunning = true;
						commandUpdates.push({
							id: command.id,
							status: "processed",
							resultMessage: "Simulation started",
						});
						break;
					case "pause":
						this.isRunning = false;
						commandUpdates.push({
							id: command.id,
							status: "processed",
							resultMessage: "Simulation paused",
						});
						break;
					case "set_speed":
						this.speedMultiplier = parsedCommand.payload.speedMultiplier;
						commandUpdates.push({
							id: command.id,
							status: "processed",
							resultMessage: `Speed multiplier set to ${parsedCommand.payload.speedMultiplier}`,
						});
						break;
					case "set_tick_interval":
						this.tickIntervalMs = parsedCommand.payload.tickIntervalMs;
						commandUpdates.push({
							id: command.id,
							status: "processed",
							resultMessage: `Tick interval set to ${parsedCommand.payload.tickIntervalMs}ms`,
						});
						break;
				}
			} catch (error) {
				commandUpdates.push({
					id: command.id,
					status: "rejected",
					resultMessage:
						error instanceof Error ? error.message : "Command rejected",
				});
			}
		}

		return { commandUpdates, appliedWorldEvents };
	}

	private parseCommand(command: CommandRow): ParsedSimCommand {
		const typeResult = simCommandTypeSchema.safeParse(command.type);
		if (!typeResult.success) {
			throw new Error(`Unsupported command type: ${command.type}`);
		}

		const type = typeResult.data;
		const payloadSchema = simCommandPayloadSchemaByType[type];
		const payloadResult = payloadSchema.safeParse(command.payload ?? {});

		if (!payloadResult.success) {
			throw new Error(payloadResult.error.issues[0]?.message ?? "Invalid command payload");
		}

		return {
			id: command.id,
			type,
			payload: payloadResult.data,
		} as ParsedSimCommand;
	}

	private createWorldEvent(
		command: ParsedSimCommand<"inject_world_event">,
		simTick: number,
	): WorldEvent {
		const payload = command.payload as InjectWorldEventCommand;
		return {
			id: payload.eventId ?? `world-event-${command.id}`,
			type: payload.type,
			title: payload.title,
			magnitude: payload.magnitude,
			affectedSymbols: [...payload.affectedSymbols],
			status: "applied",
			source: payload.source,
			requestedAtTick: simTick,
			appliedAtTick: simTick,
			payload: payload.payload,
		};
	}

	private async persistTick(
		stagedOrders: StagedOrderResult[],
		trades: Trade[],
		bars: OHLCVBar[],
		commandUpdates: CommandUpdate[],
		appliedWorldEvents: WorldEvent[],
		changedAgentIds: Set<string>,
		simulatedTime: Date,
	): Promise<void> {
		const changedEntries = Array.from(changedAgentIds)
			.map((agentId) => this.agentRegistry.get(agentId))
			.filter((entry): entry is AgentRegistryEntry => entry !== undefined);

		await this.db.transaction(async (tx) => {
			if (stagedOrders.length > 0) {
				await tx.insert(ordersTable).values(
					stagedOrders.map(({ order, reasoning }) => ({
						id: order.id,
						tick: order.createdAtTick,
						agentId: order.agentId,
						symbol: order.symbol,
						type: order.type,
						side: order.side,
						status: order.status,
						price: order.type === "market" ? null : order.price.toNumber(),
						quantity: order.qty,
						filledQuantity: order.filledQty,
						llmReasoning: reasoning,
					})),
				);
			}

			if (trades.length > 0) {
				await tx.insert(tradesTable).values(
					trades.map((trade) => ({
						id: trade.id,
						tick: trade.tick,
						symbol: trade.symbol,
						buyOrderId: trade.buyOrderId,
						sellOrderId: trade.sellOrderId,
						buyerAgentId: trade.buyerAgentId,
						sellerAgentId: trade.sellerAgentId,
						price: trade.price.toNumber(),
						quantity: trade.qty,
					})),
				);
			}

			if (bars.length > 0) {
				await tx.insert(ticksTable).values(
					bars.map((bar) => ({
						tick: bar.tick,
						symbol: bar.symbol,
						open: bar.open.toNumber(),
						high: bar.high.toNumber(),
						low: bar.low.toNumber(),
						close: bar.close.toNumber(),
						volume: bar.volume,
					})),
				);
			}

			for (const entry of changedEntries) {
				const row = serializeAgentEntryForDb(entry);
				await tx
					.insert(agentsTable)
					.values({
						...row,
						lastLlmAt:
							entry.state.lastLlmTick === null
								? null
								: new Date(simulatedTime),
					})
					.onConflictDoUpdate({
						target: agentsTable.id,
						set: {
							name: row.name,
							tier: row.tier,
							status: row.status,
							entityType: row.entityType,
							strategyType: row.strategyType,
							modelId: row.modelId,
							persona: row.persona,
							mandateSectors: row.mandateSectors,
							riskTolerance: row.riskTolerance,
							startingCapital: row.startingCapital,
							currentCash: row.currentCash,
							currentNav: row.currentNav,
							positions: row.positions,
							parameters: row.parameters,
							lastAutopilotDirective: row.lastAutopilotDirective,
							llmGroup: row.llmGroup,
							lastLlmAt:
								entry.state.lastLlmTick === null
									? null
									: new Date(simulatedTime),
						},
					});
			}

			for (const worldEvent of appliedWorldEvents) {
				await tx
					.insert(worldEventsTable)
					.values({
						eventId: worldEvent.id,
						type: worldEvent.type,
						source: worldEvent.source,
						title: worldEvent.title,
						description:
							typeof worldEvent.payload.description === "string"
								? worldEvent.payload.description
								: worldEvent.title,
						magnitude: worldEvent.magnitude,
						affectedSymbols: [...worldEvent.affectedSymbols],
						payload: worldEvent.payload,
						status: worldEvent.status,
						appliedAtTick: worldEvent.appliedAtTick,
						appliedAt: new Date(),
					})
					.onConflictDoUpdate({
						target: worldEventsTable.eventId,
						set: {
							type: worldEvent.type,
							source: worldEvent.source,
							title: worldEvent.title,
							description:
								typeof worldEvent.payload.description === "string"
									? worldEvent.payload.description
									: worldEvent.title,
							magnitude: worldEvent.magnitude,
							affectedSymbols: [...worldEvent.affectedSymbols],
							payload: worldEvent.payload,
							status: worldEvent.status,
							appliedAtTick: worldEvent.appliedAtTick,
							appliedAt: new Date(),
						},
					});
			}

			for (const commandUpdate of commandUpdates) {
				await tx
					.update(commandsTable)
					.set({
						status: commandUpdate.status,
						resultMessage: commandUpdate.resultMessage,
						processedAt: new Date(),
					})
					.where(eq(commandsTable.id, commandUpdate.id));
			}

			await tx
				.insert(simConfigTable)
				.values({
					id: SIM_CONFIG_ROW_ID,
					isRunning: this.isRunning,
					currentTick: this.simClock.simTick,
					simulatedMarketTime: simulatedTime,
					speedMultiplier: this.speedMultiplier,
					tickIntervalMs: this.tickIntervalMs,
				})
				.onConflictDoUpdate({
					target: simConfigTable.id,
					set: {
						isRunning: this.isRunning,
						currentTick: this.simClock.simTick,
						simulatedMarketTime: simulatedTime,
						speedMultiplier: this.speedMultiplier,
						tickIntervalMs: this.tickIntervalMs,
						updatedAt: new Date(),
					},
				});
		});
	}

	private async persistSimConfig(): Promise<void> {
		const simulatedTime = new Date(this.simClock.simulatedTime);

		await this.db
			.insert(simConfigTable)
			.values({
				id: SIM_CONFIG_ROW_ID,
				isRunning: this.isRunning,
				currentTick: this.simClock.simTick,
				simulatedMarketTime: simulatedTime,
				speedMultiplier: this.speedMultiplier,
				tickIntervalMs: this.tickIntervalMs,
			})
			.onConflictDoUpdate({
				target: simConfigTable.id,
				set: {
					isRunning: this.isRunning,
					currentTick: this.simClock.simTick,
					simulatedMarketTime: simulatedTime,
					speedMultiplier: this.speedMultiplier,
					tickIntervalMs: this.tickIntervalMs,
					updatedAt: new Date(),
				},
			});
	}

	private buildSimConfig(activeGroupSize: number): SimConfig {
		return {
			isRunning: this.isRunning,
			currentTick: this.simClock.simTick,
			simulatedMarketTime: new Date(this.simClock.simulatedTime),
			speedMultiplier: this.speedMultiplier,
			tickIntervalMs: this.tickIntervalMs,
			activeGroupSize,
			symbolCount: this.matchingEngine.getSymbols().length,
			agentCount: this.agentRegistry.getAll().filter(
				(entry) => entry.state.status === "active",
			).length,
		};
	}
}
