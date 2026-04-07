import { and, eq, inArray, sql } from "drizzle-orm";
import type { AgentRegistry, AgentRegistryEntry } from "#/agents/AgentRegistry";
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
import type { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { serializeOrderBookSnapshot } from "#/server/sessions";
import type { OHLCVBar, Order, OrderStatus, Trade } from "#/types/market";
import type {
	AgentEvent,
	StagedOrderResult,
	TickSummary,
	WorldEvent,
} from "#/types/sim";

export interface CommandUpdate {
	id: number;
	status: "processed" | "rejected";
	resultMessage: string;
}

export interface TickPersistInput {
	stagedOrders: StagedOrderResult[];
	trades: Trade[];
	bars: OHLCVBar[];
	agentEvents: AgentEvent[];
	commandUpdates: CommandUpdate[];
	appliedWorldEvents: WorldEvent[];
	changedAgentIds: Set<string>;
	touchedSymbols: Set<string>;
	simulatedTime: Date;
	isRunning: boolean;
	speedMultiplier: number;
	tickIntervalMs: number;
	lastSummary: TickSummary | null;
}

export interface SimConfigPersistInput {
	isRunning: boolean;
	speedMultiplier: number;
	tickIntervalMs: number;
	lastSummary: TickSummary | null;
	simTick: number;
	simulatedTime: Date;
}

function buildPersistedOrderRows(input: {
	sessionId: string;
	stagedOrders: StagedOrderResult[];
	trades: Trade[];
}): Array<{
	id: string;
	sessionId: string;
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
}> {
	const rowsById = new Map<
		string,
		{
			order: Order;
			reasoning: string | null;
		}
	>();

	for (const stagedOrder of input.stagedOrders) {
		rowsById.set(stagedOrder.order.id, {
			order: stagedOrder.order,
			reasoning: stagedOrder.reasoning,
		});
	}

	for (const trade of input.trades) {
		for (const orderState of [trade.buyOrderState, trade.sellOrderState]) {
			if (!orderState) {
				continue;
			}

			const existing = rowsById.get(orderState.id);
			rowsById.set(orderState.id, {
				order: orderState,
				reasoning: existing?.reasoning ?? orderState.llmReasoning ?? null,
			});
		}
	}

	return Array.from(rowsById.values()).map(({ order, reasoning }) => ({
		id: order.id,
		sessionId: input.sessionId,
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
	}));
}

export async function persistTick(
	db: Database,
	sessionId: string,
	agentRegistry: AgentRegistry,
	matchingEngine: MatchingEngine,
	simTick: number,
	input: TickPersistInput,
): Promise<void> {
	const changedEntries = Array.from(input.changedAgentIds)
		.map((agentId) => agentRegistry.get(agentId))
		.filter((entry): entry is AgentRegistryEntry => entry !== undefined);
	const persistedOrderRows = buildPersistedOrderRows({
		sessionId,
		stagedOrders: input.stagedOrders,
		trades: input.trades,
	});

	await db.transaction(async (tx) => {
		if (input.agentEvents.length > 0) {
			await tx.insert(agentEventsTable).values(
				input.agentEvents.map((event) => ({
					eventId: event.eventId,
					sessionId,
					agentId: event.agentId,
					type: event.type,
					tick: event.tick,
					payload: event,
				})),
			);
		}

		if (persistedOrderRows.length > 0) {
			await tx
				.insert(ordersTable)
				.values(persistedOrderRows)
				.onConflictDoUpdate({
					target: ordersTable.id,
					set: {
						status: sql`excluded.status`,
						filledQuantity: sql`excluded.filled_quantity`,
						llmReasoning: sql`coalesce(excluded.llm_reasoning, ${ordersTable.llmReasoning})`,
					},
				});
		}

		if (input.trades.length > 0) {
			await tx.insert(tradesTable).values(
				input.trades.map((trade) => ({
					id: trade.id,
					sessionId,
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

		if (input.bars.length > 0) {
			await tx.insert(ticksTable).values(
				input.bars.map((bar) => ({
					sessionId,
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
			const row = serializeAgentEntryForDb(entry, sessionId);
			await tx
				.insert(agentsTable)
				.values({
					...row,
					lastLlmAt:
						entry.state.lastLlmTick === null
							? null
							: new Date(input.simulatedTime),
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
						realizedPnl: row.realizedPnl,
						lastAutopilotDirective: row.lastAutopilotDirective,
						lastLlmTick: row.lastLlmTick,
						llmGroup: row.llmGroup,
						lastLlmAt:
							entry.state.lastLlmTick === null
								? null
								: new Date(input.simulatedTime),
					},
				});
		}

		for (const worldEvent of input.appliedWorldEvents) {
			await tx
				.insert(worldEventsTable)
				.values({
					sessionId,
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

		for (const commandUpdate of input.commandUpdates) {
			await tx
				.update(commandsTable)
				.set({
					status: commandUpdate.status,
					resultMessage: commandUpdate.resultMessage,
					processedAt: new Date(),
				})
				.where(
					and(
						eq(commandsTable.sessionId, sessionId),
						eq(commandsTable.id, commandUpdate.id),
					),
				);
		}

		for (const symbol of input.touchedSymbols) {
			const snapshot = matchingEngine.getSnapshot(symbol);
			const serializedSnapshot = serializeOrderBookSnapshot({
				sessionId,
				snapshot,
				tick: simTick,
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
				sessionId,
				isRunning: input.isRunning,
				currentTick: simTick,
				simulatedMarketTime: input.simulatedTime,
				speedMultiplier: input.speedMultiplier,
				tickIntervalMs: input.tickIntervalMs,
				lastSummary: input.lastSummary,
			})
			.onConflictDoUpdate({
				target: simConfigTable.sessionId,
				set: {
					isRunning: input.isRunning,
					currentTick: simTick,
					simulatedMarketTime: input.simulatedTime,
					speedMultiplier: input.speedMultiplier,
					tickIntervalMs: input.tickIntervalMs,
					lastSummary: input.lastSummary,
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
			.where(
				and(
					eq(simulationSessionsTable.id, sessionId),
					inArray(simulationSessionsTable.status, ["pending", "active"]),
				),
			);
	});
}

export async function persistSimConfig(
	db: Database,
	sessionId: string,
	input: SimConfigPersistInput,
): Promise<void> {
	await db
		.insert(simConfigTable)
		.values({
			sessionId,
			isRunning: input.isRunning,
			currentTick: input.simTick,
			simulatedMarketTime: input.simulatedTime,
			speedMultiplier: input.speedMultiplier,
			tickIntervalMs: input.tickIntervalMs,
			lastSummary: input.lastSummary,
		})
		.onConflictDoUpdate({
			target: simConfigTable.sessionId,
			set: {
				isRunning: input.isRunning,
				currentTick: input.simTick,
				simulatedMarketTime: input.simulatedTime,
				speedMultiplier: input.speedMultiplier,
				tickIntervalMs: input.tickIntervalMs,
				lastSummary: input.lastSummary,
				updatedAt: new Date(),
			},
		});

	await db
		.update(simulationSessionsTable)
		.set({
			status: "active",
			updatedAt: new Date(),
			endedAt: null,
		})
		.where(
			and(
				eq(simulationSessionsTable.id, sessionId),
				inArray(simulationSessionsTable.status, ["pending", "active"]),
			),
		);
}

export async function persistWorldEvents(
	db: Database,
	sessionId: string,
	events: WorldEvent[],
): Promise<void> {
	if (events.length === 0) {
		return;
	}

	await db.transaction(async (tx) => {
		for (const worldEvent of events) {
			await tx
				.insert(worldEventsTable)
				.values({
					sessionId,
					eventId: worldEvent.id,
					type: worldEvent.type,
					source: worldEvent.source,
					title: worldEvent.title,
					description:
						typeof (worldEvent.payload as Record<string, unknown>)
							?.description === "string"
							? ((worldEvent.payload as Record<string, unknown>)
									.description as string)
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
							typeof (worldEvent.payload as Record<string, unknown>)
								?.description === "string"
								? ((worldEvent.payload as Record<string, unknown>)
										.description as string)
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
	});
}
