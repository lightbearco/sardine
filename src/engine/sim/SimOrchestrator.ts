import type { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import { and, asc, eq, type InferSelectModel, sql } from "drizzle-orm";
import pLimit from "p-limit";
import { z } from "zod";
import type { AgentRegistry, AgentRegistryEntry } from "#/agents/AgentRegistry";
import { executeAutopilot } from "#/agents/autopilot";
import {
	getActiveGroupIndex,
	partitionAgentEntries,
} from "#/agents/batch-scheduler";
import { PortfolioManager } from "#/agents/PortfolioManager";
import { serializeAgentEntryForDb } from "#/agents/persistence";
import type { Database } from "#/db/index";
import {
	agentEvents as agentEventsTable,
	agents as agentsTable,
	commands as commandsTable,
	orderBookSnapshots as orderBookSnapshotsTable,
	orders as ordersTable,
	simConfig as simConfigTable,
	simulationSessions as simulationSessionsTable,
	ticks as ticksTable,
	trades as tradesTable,
	worldEvents as worldEventsTable,
} from "#/db/schema";
import type { EventBus } from "#/engine/bus/EventBus";
import type { PublicationBus } from "#/engine/bus/PublicationBus";
import type { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SIM_DEFAULTS } from "#/lib/constants";
import {
	type TradingDecision,
	tradingDecisionSchema,
} from "#/mastra/agents/trading-agent";
import { TRADING_MODEL } from "#/mastra/models";
import {
	cloneTradingRequestContext,
	type TradingRequestContextValues,
} from "#/mastra/trading-context";
import { serializeOrderBookSnapshot } from "#/server/sessions";
import type { OHLCVBar, Order, Trade } from "#/types/market";
import type { ResearchNote } from "#/types/research";
import type {
	AgentDecisionEvent,
	AgentDecisionOrder,
	AgentEvent,
	AgentFailureReason,
	AgentFailedEvent,
	AgentSignal,
	AgentSignalEvent,
	AgentThinkingDeltaEvent,
	InjectWorldEventCommand,
	ParsedSimCommand,
	SimOrchestratorState,
	SimRuntimeState,
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

type CommandRow = InferSelectModel<typeof commandsTable>;
type TradingAgentStreamLike = {
	fullStream: AsyncIterable<unknown>;
	object: Promise<TradingDecision>;
};

type TradingAgentLike = {
	stream(
		prompt: string,
		options: Record<string, unknown>,
	): Promise<TradingAgentStreamLike>;
};

interface CommandUpdate {
	id: number;
	status: "processed" | "rejected";
	resultMessage: string;
}

interface ControlCommandOutcome {
	processed: boolean;
	stepCount: number;
}

interface RuntimeHydrationState {
	isRunning: boolean;
	speedMultiplier: number;
	tickIntervalMs: number;
	lastSummary: TickSummary | null;
	agentEventSequence?: number;
}

interface ActiveAgentOutcome {
	stagedOrders: StagedOrderResult[];
}

type ReleasedResearchByAgent = Map<string, ResearchNote[]>;

class ActiveAgentGenerationError extends Error {
	constructor(
		message: string,
		public readonly failureReason: AgentFailureReason,
		public readonly transcript: string,
	) {
		super(message);
		this.name = "ActiveAgentGenerationError";
	}
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
	private tickIntervalMs: number = SIM_DEFAULTS.tickIntervalMs;
	private readonly supportedSymbols: ReadonlySet<string>;
	private readonly sessionId: string;
	private agentEventSequence = 0;
	private runtimeLogMessages: string[] = [];

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
			sessionId?: string;
			tickIntervalMs?: number;
		} = {},
	) {
		this.llmConcurrency = options.llmConcurrency ?? DEFAULT_LLM_CONCURRENCY;
		this.llmTimeoutMs = options.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
		this.groupCount = options.groupCount ?? SIM_DEFAULTS.groupCount;
		this.tickIntervalMs = options.tickIntervalMs ?? SIM_DEFAULTS.tickIntervalMs;
		this.supportedSymbols = new Set(this.matchingEngine.getSymbols());
		this.sessionId = options.sessionId ?? "default-session";
	}

	getSessionId(): string {
		return this.sessionId;
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
	async processControlCommands(): Promise<ControlCommandOutcome> {
		const pendingCommands = await this.loadPendingCommands();
		if (pendingCommands.length === 0) {
			return {
				processed: false,
				stepCount: 0,
			};
		}

		const { commandUpdates, stepCount } = this.processPendingCommands(
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
			await this.persistSimConfig();
		}

		return {
			processed: commandUpdates.length > 0,
			stepCount,
		};
	}

	getState(): SimOrchestratorState {
		return {
			isRunning: this.isRunning,
			isTicking: this.isTicking,
			simTick: this.simClock.simTick,
			simulatedTime: new Date(this.simClock.simulatedTime),
			activeGroupIndex: getActiveGroupIndex(
				this.simClock.simTick,
				this.groupCount,
			),
			lastSummary: this.lastSummary,
		};
	}

	getRuntimeState(): SimRuntimeState {
		return this.buildRuntimeState();
	}

	getReferencePrices(): Map<string, Decimal> {
		return this.matchingEngine.getReferencePrices();
	}

	hydrateRuntimeState(state: RuntimeHydrationState): void {
		this.isRunning = state.isRunning;
		this.speedMultiplier = state.speedMultiplier;
		this.tickIntervalMs = state.tickIntervalMs;
		this.lastSummary = state.lastSummary;
		this.agentEventSequence = Math.max(0, state.agentEventSequence ?? 0);
		this.runtimeLogMessages = [];
	}

	consumeRuntimeLogMessages(): string[] {
		const messages = [...this.runtimeLogMessages];
		this.runtimeLogMessages = [];
		return messages;
	}

	async tick(
		options: { skipPendingCommands?: boolean } = {},
	): Promise<TickSummary> {
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

			const pendingCommands = options.skipPendingCommands
				? []
				: await this.loadPendingCommands();
			const { commandUpdates, appliedWorldEvents } = options.skipPendingCommands
				? {
						commandUpdates: [] as CommandUpdate[],
						appliedWorldEvents: [] as WorldEvent[],
					}
				: this.processPendingCommands(pendingCommands, simTick);

			const releasedNotes = this.publicationBus.releaseDue(simTick);
			const releasedNotesByAgent = this.deliverReleasedResearch(
				releasedNotes,
				changedAgentIds,
			);

			const { active, inactive } = partitionAgentEntries(
				this.agentRegistry,
				simTick,
				this.groupCount,
			);
			this.pruneUnsupportedOpenOrders(
				[...active, ...inactive],
				changedAgentIds,
			);

			const preMatchReferencePrices = this.matchingEngine.getReferencePrices();
			const autopilotPriceMap = new Map(
				Array.from(preMatchReferencePrices.entries(), ([symbol, price]) => [
					symbol,
					price.toNumber(),
				]),
			);

			const stagedOrders: StagedOrderResult[] = [];
			const agentEvents: AgentEvent[] = [];

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

					if (!this.isSupportedSymbol(existingOrder.symbol)) {
						console.warn(
							`[SimOrchestrator] Removing cancel target ${cancelOrderId} for unsupported symbol ${existingOrder.symbol}`,
						);
						entry.state.openOrders.delete(cancelOrderId);
						changedAgentIds.add(entry.config.id);
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
				}
			}

			const activeOutcome = await this.runActiveAgents(
				active,
				simTick,
				simulatedTime,
				changedAgentIds,
				releasedNotesByAgent,
				agentEvents,
			);

			stagedOrders.push(...activeOutcome.stagedOrders);
			const dedupedOrders = this.deduplicateStagedOrders(stagedOrders);
			const { freshOrders, replayedOrders } =
				this.partitionReplayedOpenOrders(dedupedOrders);
			const { validOrders, rejectedOrders } = this.partitionUnsupportedOrders(
				freshOrders,
				changedAgentIds,
			);

			for (const stagedOrder of validOrders) {
				touchedSymbols.add(stagedOrder.order.symbol);
			}

			const trades = this.matchingEngine.processOrders(
				validOrders.map((stagedOrder) => stagedOrder.order),
				simTick,
			);

			for (const trade of trades) {
				changedAgentIds.add(trade.buyerAgentId);
				changedAgentIds.add(trade.sellerAgentId);
				touchedSymbols.add(trade.symbol);
			}

			const persistedOrders = [
				...validOrders,
				...replayedOrders,
				...rejectedOrders,
			];

			for (const stagedOrder of persistedOrders) {
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
				persistedOrders,
				trades,
				bars,
				agentEvents,
				commandUpdates,
				appliedWorldEvents,
				changedAgentIds,
				touchedSymbols,
				simulatedTime,
			);

			for (const stagedOrder of persistedOrders) {
				this.eventBus.emit("order", stagedOrder.order);
			}

			for (const trade of trades) {
				this.eventBus.emit("trade", trade);
			}

			for (const symbol of touchedSymbols) {
				this.eventBus.emit(
					"lob-update",
					this.matchingEngine.getSnapshot(symbol),
				);
			}

			for (const bar of bars) {
				this.eventBus.emit("ohlcv", bar);
			}

			for (const event of appliedWorldEvents) {
				this.eventBus.emit("world-event", event);
			}

			const summary: TickSummary = {
				durationMs: Date.now() - tickStartedAt,
				orderCount: persistedOrders.length,
				tradeCount: trades.length,
				activeAgents: active.length,
				simTick,
				simulatedTime,
				trades,
				isRunning: this.isRunning,
			};

			this.lastSummary = summary;
			await this.persistSimConfig();
			this.eventBus.emit("tick", { simTick, simulatedTime });
			this.eventBus.emit("sim-state", this.buildRuntimeState(active.length));

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
		releasedNotesByAgent: ReleasedResearchByAgent,
		agentEvents: AgentEvent[],
	): Promise<ActiveAgentOutcome> {
		const limit = pLimit(this.llmConcurrency);
		const tasks = activeEntries.map((entry) =>
			limit(() =>
				this.generateForActiveAgent(
					entry,
					simTick,
					simulatedTime,
					releasedNotesByAgent.get(entry.config.id) ?? [],
					agentEvents,
				),
			),
		);
		const settledResults = await Promise.allSettled(tasks);
		const stagedOrders: StagedOrderResult[] = [];

		for (const [index, settled] of settledResults.entries()) {
			const entry = activeEntries[index];

			if (settled.status === "fulfilled") {
				entry.state.lastAutopilotDirective =
					settled.value.decision.autopilotDirective;
				entry.state.lastLlmTick = simTick;
				changedAgentIds.add(entry.config.id);
				stagedOrders.push(...settled.value.orders);
				continue;
			}

			const failure = this.normalizeActiveAgentFailure(settled.reason);
			const fallbackDirective = this.buildFallbackDirective(entry);
			console.error(
				`[LLM FAIL] Agent "${entry.config.name}" (${entry.config.id}) tick ${simTick}:`,
				failure.message,
			);
			entry.state.lastAutopilotDirective = fallbackDirective;
			entry.state.lastLlmTick = simTick;
			changedAgentIds.add(entry.config.id);
			this.emitAndCollectAgentEvent(
				agentEvents,
				{
					type: "failed",
					agentId: entry.config.id,
					agentName: entry.config.name,
					tick: simTick,
					reason: failure.reason,
					message: failure.message,
					transcript: failure.transcript,
					fallbackDirective,
				} as Omit<AgentFailedEvent, "eventId">,
			);
		}

		return { stagedOrders };
	}

	private async generateForActiveAgent(
		entry: AgentRegistryEntry,
		simTick: number,
		simulatedTime: Date,
		releasedThisTick: ResearchNote[],
		agentEvents: AgentEvent[],
	): Promise<{
		decision: TradingDecision;
		orders: StagedOrderResult[];
	}> {
		const requestContext = cloneTradingRequestContext(
			entry.requestContext as unknown as RequestContext<TradingRequestContextValues>,
		);
		requestContext.set("agent-registry", this.agentRegistry);
		requestContext.set("matching-engine", this.matchingEngine);
		requestContext.set("sim-tick", simTick);
		requestContext.set(
			"released-research-notes",
			this.getReleasedNotesForAgent(entry),
		);

		const prompt = this.buildTickPrompt(
			entry,
			simTick,
			simulatedTime,
			releasedThisTick,
		);
		this.emitAndCollectAgentEvent(agentEvents, {
			type: "run_started",
			agentId: entry.config.id,
			agentName: entry.config.name,
			tick: simTick,
		});

		let transcript = "";

		try {
			const stream = await this.streamWithTimeout(prompt, requestContext);
			const consumeThinkingPromise = this.consumeAgentThinkingStream(
				stream.fullStream,
				entry,
				simTick,
				agentEvents,
				(delta) => {
					transcript += delta;
				},
			);

			const decision = tradingDecisionSchema.parse(await stream.object);
			await consumeThinkingPromise;

			const decisionOrders: AgentDecisionOrder[] = decision.ordersPlaced.map(
				(placedOrder) => ({
					orderId: placedOrder.orderId,
					symbol: placedOrder.symbol,
					side: placedOrder.side,
					type: placedOrder.type,
					qty: placedOrder.qty,
					price: placedOrder.price,
					status: placedOrder.status,
					filledQty: placedOrder.filledQty,
					rejectionReason: placedOrder.rejectionReason,
				}),
			);
			const decisionEvent: Omit<AgentDecisionEvent, "eventId"> = {
				type: "decision",
				agentId: entry.config.id,
				agentName: entry.config.name,
				tick: simTick,
				decision: {
					reasoning: decision.reasoning,
					ordersPlaced: decisionOrders,
					autopilotDirective: decision.autopilotDirective,
				},
			};
			this.emitAndCollectAgentEvent(agentEvents, decisionEvent);

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

			for (const { order, reasoning } of orders) {
				const signal: AgentSignal = {
					agentId: entry.config.id,
					agentName: entry.config.name,
					side: order.side,
					symbol: order.symbol,
					price: order.type === "market" ? 0 : order.price.toNumber(),
					qty: order.qty,
					reasoning,
					tick: simTick,
				};

				this.emitAndCollectAgentEvent(
					agentEvents,
					{
						type: "signal",
						agentId: entry.config.id,
						agentName: entry.config.name,
						tick: simTick,
						signal,
					} as Omit<AgentSignalEvent, "eventId">,
				);
			}

			return { decision, orders };
		} catch (error) {
			throw this.classifyActiveAgentFailure(error, transcript);
		}
	}

	private async streamWithTimeout(
		prompt: string,
		requestContext: ReturnType<typeof cloneTradingRequestContext>,
	): Promise<TradingAgentStreamLike> {
		const controller = new AbortController();
		const timeoutHandle = setTimeout(() => {
			controller.abort("LLM generation timed out");
		}, this.llmTimeoutMs);

		try {
			return await this.tradingAgent.stream(prompt, {
				requestContext,
				maxSteps: 6,
				abortSignal: controller.signal,
				structuredOutput: {
					schema: tradingDecisionSchema,
					model: this.resolveStructuredOutputModel(),
					jsonPromptInjection: true,
				},
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new ActiveAgentGenerationError(
					"LLM generation timed out",
					"timeout",
					"",
				);
			}

			throw error;
		} finally {
			clearTimeout(timeoutHandle);
		}
	}

	private resolveStructuredOutputModel() {
		return TRADING_MODEL;
	}

	private async consumeAgentThinkingStream(
		fullStream: AsyncIterable<unknown>,
		entry: AgentRegistryEntry,
		simTick: number,
		agentEvents: AgentEvent[],
		onDelta: (delta: string) => void,
	): Promise<void> {
		let transcript = "";

		for await (const chunk of fullStream) {
			const delta = this.extractAgentThinkingDelta(chunk);
			if (!delta) {
				continue;
			}

			transcript += delta;
			onDelta(delta);
			this.emitAndCollectAgentEvent(
				agentEvents,
				{
					type: "thinking_delta",
					agentId: entry.config.id,
					agentName: entry.config.name,
					tick: simTick,
					delta,
					transcript,
				} as Omit<AgentThinkingDeltaEvent, "eventId">,
			);
		}
	}

	private extractAgentThinkingDelta(chunk: unknown): string | null {
		if (!chunk || typeof chunk !== "object") {
			return null;
		}

		const streamChunk = chunk as {
			type?: string;
			payload?: {
				text?: string;
			};
		};

		if (
			streamChunk.type !== "text-delta" &&
			streamChunk.type !== "reasoning-delta"
		) {
			return null;
		}

		return typeof streamChunk.payload?.text === "string"
			? streamChunk.payload.text
			: null;
	}

	private classifyActiveAgentFailure(
		error: unknown,
		transcript: string,
	): ActiveAgentGenerationError {
		if (error instanceof ActiveAgentGenerationError) {
			return new ActiveAgentGenerationError(
				error.message,
				error.failureReason,
				transcript || error.transcript,
			);
		}

		if (error instanceof z.ZodError || this.isSchemaValidationError(error)) {
			const message =
				error instanceof Error
					? error.message
					: "Structured output validation failed";
			return new ActiveAgentGenerationError(
				message,
				"schema_validation_failed",
				transcript,
			);
		}

		const message =
			error instanceof Error ? error.message : "LLM generation failed";
		return new ActiveAgentGenerationError(message, "llm_error", transcript);
	}

	private normalizeActiveAgentFailure(error: unknown): {
		reason: AgentFailureReason;
		message: string;
		transcript: string;
	} {
		if (error instanceof ActiveAgentGenerationError) {
			return {
				reason: error.failureReason,
				message: error.message,
				transcript: error.transcript,
			};
		}

		if (error instanceof Error) {
			return {
				reason: this.isSchemaValidationError(error)
					? "schema_validation_failed"
					: "llm_error",
				message: error.message,
				transcript: "",
			};
		}

		return {
			reason: "llm_error",
			message: "LLM generation failed",
			transcript: "",
		};
	}

	private isSchemaValidationError(error: unknown): boolean {
		if (!(error instanceof Error)) {
			return false;
		}

		const message = error.message.toLowerCase();
		return (
			message.includes("schema") ||
			message.includes("validation") ||
			message.includes("structured output") ||
			message.includes("invalid_type") ||
			message.includes("zod")
		);
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

	private pruneUnsupportedOpenOrders(
		entries: AgentRegistryEntry[],
		changedAgentIds: Set<string>,
	): void {
		for (const entry of entries) {
			const supportedOpenOrders = new Map<string, Order>();
			let removedUnsupported = false;

			for (const [orderId, order] of entry.state.openOrders.entries()) {
				if (this.isSupportedSymbol(order.symbol)) {
					supportedOpenOrders.set(orderId, order);
					continue;
				}

				removedUnsupported = true;
				console.warn(
					`[SimOrchestrator] Dropping stale open order ${order.id} for unsupported symbol ${order.symbol}`,
				);
			}

			if (!removedUnsupported) {
				continue;
			}

			entry.state.openOrders = supportedOpenOrders;
			changedAgentIds.add(entry.config.id);
		}
	}

	private deduplicateStagedOrders(
		stagedOrders: StagedOrderResult[],
	): StagedOrderResult[] {
		const ordersById = new Map<string, StagedOrderResult>();

		for (const stagedOrder of stagedOrders) {
			const existingOrder = ordersById.get(stagedOrder.order.id);
			if (!existingOrder) {
				ordersById.set(stagedOrder.order.id, stagedOrder);
				continue;
			}

			if (
				this.hasConflictingOrderIdentity(existingOrder.order, stagedOrder.order)
			) {
				console.error(
					`[SimOrchestrator] Conflicting replay for order ${stagedOrder.order.id}; discarding duplicate stage`,
					{
						existing: {
							agentId: existingOrder.order.agentId,
							symbol: existingOrder.order.symbol,
							side: existingOrder.order.side,
							type: existingOrder.order.type,
						},
						incoming: {
							agentId: stagedOrder.order.agentId,
							symbol: stagedOrder.order.symbol,
							side: stagedOrder.order.side,
							type: stagedOrder.order.type,
						},
					},
				);
				continue;
			}

			console.warn(
				`[SimOrchestrator] Duplicate staged order ${stagedOrder.order.id}; keeping latest version`,
			);
			ordersById.set(stagedOrder.order.id, stagedOrder);
		}

		return Array.from(ordersById.values());
	}

	private partitionUnsupportedOrders(
		stagedOrders: StagedOrderResult[],
		changedAgentIds: Set<string>,
	): {
		validOrders: StagedOrderResult[];
		rejectedOrders: StagedOrderResult[];
	} {
		const validOrders: StagedOrderResult[] = [];
		const rejectedOrders: StagedOrderResult[] = [];

		for (const stagedOrder of stagedOrders) {
			if (this.isSupportedSymbol(stagedOrder.order.symbol)) {
				validOrders.push(stagedOrder);
				continue;
			}

			const rejectionReason = `[system] unsupported_symbol:${stagedOrder.order.symbol}`;
			console.warn(
				`[SimOrchestrator] Rejecting order ${stagedOrder.order.id} for unsupported symbol ${stagedOrder.order.symbol}`,
			);
			rejectedOrders.push({
				...stagedOrder,
				order: {
					...stagedOrder.order,
					status: "cancelled",
					llmReasoning: stagedOrder.order.llmReasoning
						? `${stagedOrder.order.llmReasoning}\n\n${rejectionReason}`
						: rejectionReason,
				},
				reasoning: stagedOrder.reasoning
					? `${stagedOrder.reasoning}\n\n${rejectionReason}`
					: rejectionReason,
			});
			changedAgentIds.add(stagedOrder.order.agentId);
		}

		return {
			validOrders,
			rejectedOrders,
		};
	}

	private partitionReplayedOpenOrders(stagedOrders: StagedOrderResult[]): {
		freshOrders: StagedOrderResult[];
		replayedOrders: StagedOrderResult[];
	} {
		const freshOrders: StagedOrderResult[] = [];
		const replayedOrders: StagedOrderResult[] = [];

		for (const stagedOrder of stagedOrders) {
			const existingOrder = this.agentRegistry
				.get(stagedOrder.order.agentId)
				?.state.openOrders.get(stagedOrder.order.id);

			if (!existingOrder) {
				freshOrders.push(stagedOrder);
				continue;
			}

			console.warn(
				`[SimOrchestrator] Ignoring replayed open order ${stagedOrder.order.id}; persisting current state without re-matching`,
			);
			replayedOrders.push({
				...stagedOrder,
				order: existingOrder,
				reasoning: stagedOrder.reasoning ?? existingOrder.llmReasoning ?? null,
			});
		}

		return {
			freshOrders,
			replayedOrders,
		};
	}

	private hasConflictingOrderIdentity(left: Order, right: Order): boolean {
		return (
			left.agentId !== right.agentId ||
			left.symbol !== right.symbol ||
			left.side !== right.side ||
			left.type !== right.type
		);
	}

	private isSupportedSymbol(symbol: string): boolean {
		return this.supportedSymbols.has(symbol);
	}

	private deliverReleasedResearch(
		releasedNotes: ReturnType<PublicationBus["releaseDue"]>,
		changedAgentIds: Set<string>,
	): ReleasedResearchByAgent {
		const notesByTier = {
			tier1: releasedNotes.tier1,
			tier2: releasedNotes.tier2,
			tier3: releasedNotes.tier3,
		} as const;
		const deliveredByAgent: ReleasedResearchByAgent = new Map();

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
			const newlyDelivered: ResearchNote[] = [];

			for (const note of tierNotes) {
				if (entry.state.researchInbox.has(note.id)) {
					continue;
				}

				entry.state.researchInbox.set(note.id, {
					...note,
					releasedToTier: entry.state.tier,
				});
				newlyDelivered.push({
					...note,
					releasedToTier: entry.state.tier,
				});
				inboxChanged = true;
			}

			if (newlyDelivered.length > 0) {
				deliveredByAgent.set(entry.config.id, newlyDelivered);
			}

			if (inboxChanged) {
				changedAgentIds.add(entry.config.id);
			}
		}

		return deliveredByAgent;
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
		releasedThisTick: ResearchNote[] = [],
	): string {
		const notes = this.getReleasedNotesForPrompt(entry, releasedThisTick).slice(
			0,
			3,
		);
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

	private getReleasedNotesForPrompt(
		entry: AgentRegistryEntry,
		releasedThisTick: ResearchNote[],
	): ResearchNote[] {
		const inboxNotes = this.getReleasedNotesForAgent(entry);
		if (releasedThisTick.length === 0) {
			return inboxNotes;
		}

		const merged = new Map<string, ResearchNote>();
		for (const note of releasedThisTick) {
			merged.set(note.id, note);
		}
		for (const note of inboxNotes) {
			if (!merged.has(note.id)) {
				merged.set(note.id, note);
			}
		}

		return Array.from(merged.values()).sort(
			(left, right) => right.publishedAtTick - left.publishedAtTick,
		);
	}

	private buildFallbackDirective(
		entry: AgentRegistryEntry,
	): TradingDecision["autopilotDirective"] {
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

	private queueRuntimeLog(message: string): void {
		this.runtimeLogMessages.push(message);
	}

	private async loadPendingCommands(): Promise<CommandRow[]> {
		return this.db
			.select()
			.from(commandsTable)
			.where(
				and(
					eq(commandsTable.sessionId, this.sessionId),
					eq(commandsTable.status, "pending"),
				),
			)
			.orderBy(asc(commandsTable.id));
	}

	private processPendingCommands(
		pendingCommands: CommandRow[],
		simTick: number,
	): {
		commandUpdates: CommandUpdate[];
		appliedWorldEvents: WorldEvent[];
		stepCount: number;
	} {
		const commandUpdates: CommandUpdate[] = [];
		const appliedWorldEvents: WorldEvent[] = [];
		let stepCount = 0;

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
						this.queueRuntimeLog("control:start -> Simulation started");
						break;
					case "pause":
						this.isRunning = false;
						commandUpdates.push({
							id: command.id,
							status: "processed",
							resultMessage: "Simulation paused",
						});
						this.queueRuntimeLog("control:pause -> Simulation paused");
						break;
					case "step":
						if (this.isRunning) {
							commandUpdates.push({
								id: command.id,
								status: "processed",
								resultMessage: "Simulation already running; step ignored",
							});
							this.queueRuntimeLog(
								"control:step -> Simulation already running; step ignored",
							);
							break;
						}

						stepCount += 1;
						commandUpdates.push({
							id: command.id,
							status: "processed",
							resultMessage: "Single tick step queued",
						});
						this.queueRuntimeLog("control:step -> Single tick step queued");
						break;
					case "set_speed": {
						const speedPayload = parsedCommand.payload as {
							speedMultiplier: number;
						};
						this.speedMultiplier = speedPayload.speedMultiplier;
						commandUpdates.push({
							id: command.id,
							status: "processed",
							resultMessage: `Speed multiplier set to ${speedPayload.speedMultiplier}`,
						});
						this.queueRuntimeLog(
							`control:set_speed -> Speed multiplier set to ${speedPayload.speedMultiplier}`,
						);
						break;
					}
					case "set_tick_interval": {
						const intervalPayload = parsedCommand.payload as {
							tickIntervalMs: number;
						};
						this.tickIntervalMs = intervalPayload.tickIntervalMs;
						commandUpdates.push({
							id: command.id,
							status: "processed",
							resultMessage: `Tick interval set to ${intervalPayload.tickIntervalMs}ms`,
						});
						this.queueRuntimeLog(
							`control:set_tick_interval -> Tick interval set to ${intervalPayload.tickIntervalMs}ms`,
						);
						break;
					}
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

		return { commandUpdates, appliedWorldEvents, stepCount };
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
			throw new Error(
				payloadResult.error.issues[0]?.message ?? "Invalid command payload",
			);
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
		agentEvents: AgentEvent[],
		commandUpdates: CommandUpdate[],
		appliedWorldEvents: WorldEvent[],
		changedAgentIds: Set<string>,
		touchedSymbols: Set<string>,
		simulatedTime: Date,
	): Promise<void> {
		const changedEntries = Array.from(changedAgentIds)
			.map((agentId) => this.agentRegistry.get(agentId))
			.filter((entry): entry is AgentRegistryEntry => entry !== undefined);

		await this.db.transaction(async (tx) => {
			if (agentEvents.length > 0) {
				await tx.insert(agentEventsTable).values(
					agentEvents.map((event) => ({
						eventId: event.eventId,
						sessionId: this.sessionId,
						agentId: event.agentId,
						type: event.type,
						tick: event.tick,
						payload: event,
					})),
				);
			}

			if (stagedOrders.length > 0) {
				await tx
					.insert(ordersTable)
					.values(
						stagedOrders.map(({ order, reasoning }) => ({
							id: order.id,
							sessionId: this.sessionId,
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
					)
					.onConflictDoUpdate({
						target: ordersTable.id,
						set: {
							status: sql`excluded.status`,
							filledQuantity: sql`excluded.filled_quantity`,
							llmReasoning: sql`excluded.llm_reasoning`,
						},
					});
			}

			if (trades.length > 0) {
				await tx.insert(tradesTable).values(
					trades.map((trade) => ({
						id: trade.id,
						sessionId: this.sessionId,
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
						sessionId: this.sessionId,
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
				const row = serializeAgentEntryForDb(entry, this.sessionId);
				await tx
					.insert(agentsTable)
					.values({
						...row,
						lastLlmAt:
							entry.state.lastLlmTick === null ? null : new Date(simulatedTime),
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
						sessionId: this.sessionId,
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
					.where(
						and(
							eq(commandsTable.sessionId, this.sessionId),
							eq(commandsTable.id, commandUpdate.id),
						),
					);
			}

			for (const symbol of touchedSymbols) {
				const snapshot = this.matchingEngine.getSnapshot(symbol);
				const serializedSnapshot = serializeOrderBookSnapshot({
					sessionId: this.sessionId,
					snapshot,
					tick: this.simClock.simTick,
				});

				await tx
					.insert(orderBookSnapshotsTable)
					.values(serializedSnapshot)
					.onConflictDoUpdate({
						target: [
							orderBookSnapshotsTable.sessionId,
							orderBookSnapshotsTable.symbol,
						],
						set: {
							tick: serializedSnapshot.tick,
							bids: serializedSnapshot.bids,
							asks: serializedSnapshot.asks,
							lastPrice: serializedSnapshot.lastPrice,
							spread: serializedSnapshot.spread,
							updatedAt: serializedSnapshot.updatedAt,
						},
					});
			}

			await tx
				.insert(simConfigTable)
				.values({
					sessionId: this.sessionId,
					isRunning: this.isRunning,
					currentTick: this.simClock.simTick,
					simulatedMarketTime: simulatedTime,
					speedMultiplier: this.speedMultiplier,
					tickIntervalMs: this.tickIntervalMs,
					lastSummary: this.lastSummary,
				})
				.onConflictDoUpdate({
					target: simConfigTable.sessionId,
					set: {
						isRunning: this.isRunning,
						currentTick: this.simClock.simTick,
						simulatedMarketTime: simulatedTime,
						speedMultiplier: this.speedMultiplier,
						tickIntervalMs: this.tickIntervalMs,
						lastSummary: this.lastSummary,
						updatedAt: new Date(),
					},
				});

			await tx
				.update(simulationSessionsTable)
				.set({
					status: "active",
					updatedAt: new Date(),
					endedAt: null,
				})
				.where(eq(simulationSessionsTable.id, this.sessionId));
		});
	}

	private async persistSimConfig(): Promise<void> {
		const simulatedTime = new Date(this.simClock.simulatedTime);

		await this.db
			.insert(simConfigTable)
			.values({
				sessionId: this.sessionId,
				isRunning: this.isRunning,
				currentTick: this.simClock.simTick,
				simulatedMarketTime: simulatedTime,
				speedMultiplier: this.speedMultiplier,
				tickIntervalMs: this.tickIntervalMs,
				lastSummary: this.lastSummary,
			})
			.onConflictDoUpdate({
				target: simConfigTable.sessionId,
				set: {
					isRunning: this.isRunning,
					currentTick: this.simClock.simTick,
					simulatedMarketTime: simulatedTime,
					speedMultiplier: this.speedMultiplier,
					tickIntervalMs: this.tickIntervalMs,
					lastSummary: this.lastSummary,
					updatedAt: new Date(),
				},
			});

		await this.db
			.update(simulationSessionsTable)
			.set({
				status: "active",
				updatedAt: new Date(),
				endedAt: null,
			})
			.where(eq(simulationSessionsTable.id, this.sessionId));
	}

	private emitAndCollectAgentEvent(
		agentEvents: AgentEvent[],
		event: Omit<AgentEvent, "eventId">,
	): AgentEvent {
		const nextEvent = {
			...event,
			eventId: `${this.sessionId}:agent-event:${this.agentEventSequence++}`,
		} as AgentEvent;
		agentEvents.push(nextEvent);
		this.eventBus.emit("agent-event", nextEvent);
		return nextEvent;
	}

	private buildRuntimeState(activeGroupSize?: number): SimRuntimeState {
		const resolvedActiveGroupSize =
			activeGroupSize ??
			partitionAgentEntries(
				this.agentRegistry,
				this.simClock.simTick,
				this.groupCount,
			).active.length;

		return {
			isRunning: this.isRunning,
			isTicking: this.isTicking,
			simTick: this.simClock.simTick,
			simulatedTime: new Date(this.simClock.simulatedTime),
			activeGroupIndex: getActiveGroupIndex(
				this.simClock.simTick,
				this.groupCount,
			),
			speedMultiplier: this.speedMultiplier,
			tickIntervalMs: this.tickIntervalMs,
			activeGroupSize: resolvedActiveGroupSize,
			symbolCount: this.matchingEngine.getSymbols().length,
			agentCount: this.agentRegistry.getAll().length,
			lastSummary: this.lastSummary,
		};
	}
}
