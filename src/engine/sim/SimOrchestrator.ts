import Decimal from "decimal.js";
import { and, asc, eq, type InferSelectModel } from "drizzle-orm";
import type { AgentRegistry } from "#/agents/AgentRegistry";
import { executeAutopilot } from "#/agents/autopilot";
import {
	getActiveGroupIndex,
	partitionAgentEntries,
} from "#/agents/batch-scheduler";
import { requoteMarketMakers } from "#/agents/market-maker-liquidity";
import { PortfolioManager } from "#/agents/PortfolioManager";
import type { Database } from "#/db/index";
import { createLogger } from "#/lib/logger";
import { commands as commandsTable } from "#/db/schema";
import type { EventBus } from "#/engine/bus/EventBus";
import type { PublicationBus } from "#/engine/bus/PublicationBus";
import type { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SIM_DEFAULTS } from "#/lib/constants";
import type { TradingDecision } from "#/mastra/agents/trading-agent";
import type { Trade } from "#/types/market";
import type {
	AgentEvent,
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
import {
	runActiveAgents,
	type ActiveAgentRunnerDeps,
} from "./active-agent-runner";
import { computeOhlcvBars } from "./ohlcv";
import {
	deduplicateStagedOrders,
	partitionReplayedOpenOrders,
	partitionUnsupportedOrders,
	pruneUnsupportedOpenOrders,
	syncOrderState,
} from "./order-pipeline";
import {
	deliverReleasedResearch,
	getReleasedNotesForAgent as getReleasedNotesForAgentExternal,
} from "./research-delivery";
import { buildTickPrompt as buildTickPromptExternal } from "./tick-prompt";
import {
	persistTick as persistTickExternal,
	persistSimConfig as persistSimConfigExternal,
	persistWorldEvents as persistWorldEventsExternal,
	type CommandUpdate,
	type SimConfigPersistInput,
	type TickPersistInput,
} from "./tick-persistence";

const DEFAULT_LLM_CONCURRENCY = 10;
const DEFAULT_LLM_TIMEOUT_MS = 15_000;
const log = createLogger("SimOrchestrator");

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

	async processControlCommands(): Promise<ControlCommandOutcome> {
		const pendingCommands = await this.loadPendingCommands();
		if (pendingCommands.length === 0) {
			return {
				processed: false,
				stepCount: 0,
			};
		}

		const { commandUpdates, appliedWorldEvents, stepCount } =
			this.processPendingCommands(pendingCommands, this.simClock.simTick);

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

		if (appliedWorldEvents.length > 0) {
			await persistWorldEventsExternal(
				this.db,
				this.sessionId,
				appliedWorldEvents,
			);
			for (const event of appliedWorldEvents) {
				this.eventBus.emit("world-event", event);
			}
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
			const releasedNotesByAgent = deliverReleasedResearch(
				this.agentRegistry,
				releasedNotes,
				changedAgentIds,
			);

			const { active, inactive } = partitionAgentEntries(
				this.agentRegistry,
				simTick,
				this.groupCount,
			);
			pruneUnsupportedOpenOrders(
				this.supportedSymbols,
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

					if (!this.supportedSymbols.has(existingOrder.symbol)) {
						log.warn(
							{ orderId: cancelOrderId, symbol: existingOrder.symbol },
							"removing cancel target for unsupported symbol",
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

			const requoteOrders = requoteMarketMakers(
				this.agentRegistry,
				this.matchingEngine,
				simTick,
			);
			stagedOrders.push(...requoteOrders);

			const activeRunnerDeps: ActiveAgentRunnerDeps = {
				tradingAgent: this.tradingAgent,
				agentRegistry: this.agentRegistry,
				matchingEngine: this.matchingEngine,
				sessionId: this.sessionId,
				llmConcurrency: this.llmConcurrency,
				llmTimeoutMs: this.llmTimeoutMs,
				buildTickPrompt: buildTickPromptExternal,
				getReleasedNotesForAgent: (agentId: string) =>
					getReleasedNotesForAgentExternal(this.agentRegistry, agentId),
				emitAndCollectAgentEvent: (events, event) =>
					this.emitAndCollectAgentEvent(events, event),
				emitThinkingDelta: (delta) =>
					this.eventBus.emit("agent-thinking", delta),
			};

			const activeOutcome = await runActiveAgents(
				activeRunnerDeps,
				active,
				simTick,
				simulatedTime,
				changedAgentIds,
				releasedNotesByAgent,
				agentEvents,
			);

			stagedOrders.push(...activeOutcome.stagedOrders);
			const dedupedOrders = deduplicateStagedOrders(stagedOrders);
			const { freshOrders, replayedOrders } = partitionReplayedOpenOrders(
				this.agentRegistry,
				dedupedOrders,
			);
			const { validOrders, rejectedOrders } = partitionUnsupportedOrders(
				this.supportedSymbols,
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

			const sweepTrades = this.matchingEngine.sweepCrossingBooks(simTick);
			trades.push(...sweepTrades);

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
				syncOrderState(this.agentRegistry, stagedOrder.order, changedAgentIds);
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

			for (const trade of trades) {
				const buyerEntry = this.agentRegistry.get(trade.buyerAgentId);
				const sellerEntry = this.agentRegistry.get(trade.sellerAgentId);
				if (buyerEntry) {
					buyerEntry.state.pendingFills.push(trade);
				}
				if (sellerEntry && sellerEntry !== buyerEntry) {
					sellerEntry.state.pendingFills.push(trade);
				}
			}

			const bars = computeOhlcvBars(trades);
			const barsBySymbol = new Set(bars.map((bar) => bar.symbol));
			const refPrices = this.matchingEngine.getReferencePrices();
			for (const sym of touchedSymbols) {
				if (barsBySymbol.has(sym)) continue;
				const refPrice = refPrices.get(sym);
				if (!refPrice) continue;
				bars.push({
					symbol: sym,
					open: refPrice,
					high: refPrice,
					low: refPrice,
					close: refPrice,
					volume: 0,
					tick: simTick,
				});
			}
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

	private queueRuntimeLog(message: string): void {
		this.runtimeLogMessages.push(message);
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

	private async persistTick(
		stagedOrders: StagedOrderResult[],
		trades: Trade[],
		bars: import("#/types/market").OHLCVBar[],
		agentEvents: AgentEvent[],
		commandUpdates: CommandUpdate[],
		appliedWorldEvents: WorldEvent[],
		changedAgentIds: Set<string>,
		touchedSymbols: Set<string>,
		simulatedTime: Date,
	): Promise<void> {
		const input: TickPersistInput = {
			stagedOrders,
			trades,
			bars,
			agentEvents,
			commandUpdates,
			appliedWorldEvents,
			changedAgentIds,
			touchedSymbols,
			simulatedTime,
			isRunning: this.isRunning,
			speedMultiplier: this.speedMultiplier,
			tickIntervalMs: this.tickIntervalMs,
			lastSummary: this.lastSummary,
		};
		await persistTickExternal(
			this.db,
			this.sessionId,
			this.agentRegistry,
			this.matchingEngine,
			this.simClock.simTick,
			input,
		);
	}

	private async persistSimConfig(): Promise<void> {
		const simulatedTime = new Date(this.simClock.simulatedTime);
		const input: SimConfigPersistInput = {
			isRunning: this.isRunning,
			speedMultiplier: this.speedMultiplier,
			tickIntervalMs: this.tickIntervalMs,
			lastSummary: this.lastSummary,
			simTick: this.simClock.simTick,
			simulatedTime,
		};
		await persistSimConfigExternal(this.db, this.sessionId, input);
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
