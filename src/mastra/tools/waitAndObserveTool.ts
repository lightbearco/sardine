import { createTool } from "@mastra/core/tools";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db/index";
import {
	agents,
	commands,
	orders,
	simConfig,
	ticks,
	trades,
	worldEvents,
} from "#/db/schema";
import {
	resolveChatSessionId,
	type ChatRequestContextValues,
} from "#/mastra/chat-context";

const waitAndObserveInputSchema = z.object({
	sessionId: z.string().min(1).optional(),
	eventId: z.string().min(1),
});

const waitAndObserveOutputSchema = z.object({
	eventId: z.string(),
	eventStatus: z.string(),
	eventTitle: z.string().optional(),
	appliedAtTick: z.number().nullable(),
	currentTick: z.number(),
	ticksSinceEvent: z.number().nullable(),
	priceChanges: z.array(
		z.object({
			symbol: z.string(),
			priceBefore: z.number().nullable(),
			priceAfter: z.number().nullable(),
			changePct: z.number().nullable(),
		}),
	),
	volumeSummary: z.object({
		totalTrades: z.number(),
		totalVolume: z.number(),
	}),
	notableActions: z.array(
		z.object({
			agentId: z.string(),
			agentName: z.string().optional(),
			side: z.string(),
			symbol: z.string(),
			qty: z.number(),
			reasoning: z.string().nullable(),
		}),
	),
	message: z.string(),
});

export const waitAndObserveTool = createTool<
	"wait-and-observe",
	typeof waitAndObserveInputSchema,
	typeof waitAndObserveOutputSchema,
	undefined,
	undefined,
	ChatRequestContextValues
>({
	id: "wait-and-observe",
	description:
		"Check the current aftermath of a previously injected world event. Returns the event status, price changes for affected symbols, volume summary, and notable agent actions since the event was applied. Call repeatedly to get updated observations as more ticks elapse.",
	inputSchema: waitAndObserveInputSchema,
	outputSchema: waitAndObserveOutputSchema,
	execute: async (input, context) => {
		const sessionId = resolveChatSessionId({
			sessionId: input.sessionId,
			requestContext: context?.requestContext,
		});
		const { eventId } = input;
		const loadCurrentTick = async () => {
			const configRows = await db
				.select({ currentTick: simConfig.currentTick })
				.from(simConfig)
				.where(eq(simConfig.sessionId, sessionId))
				.limit(1);

			return configRows[0]?.currentTick ?? 0;
		};

		const eventRows = await db
			.select({
				eventId: worldEvents.eventId,
				status: worldEvents.status,
				title: worldEvents.title,
				affectedSymbols: worldEvents.affectedSymbols,
				appliedAtTick: worldEvents.appliedAtTick,
			})
			.from(worldEvents)
			.where(
				and(
					eq(worldEvents.sessionId, sessionId),
					eq(worldEvents.eventId, eventId),
				),
			)
			.limit(1);

		const event = eventRows[0];
		if (!event) {
			const commandRows = await db
				.select({
					status: commands.status,
					resultMessage: commands.resultMessage,
					payload: commands.payload,
				})
				.from(commands)
				.where(
					and(
						eq(commands.sessionId, sessionId),
						eq(commands.type, "inject_world_event"),
						sql`${commands.payload}->>'eventId' = ${eventId}`,
					),
				)
				.orderBy(desc(commands.id))
				.limit(1);

			const command = commandRows[0];
			if (command) {
				const currentTick = await loadCurrentTick();
				const payload =
					command.payload && typeof command.payload === "object"
						? (command.payload as {
								title?: unknown;
							})
						: {};
				const eventTitle =
					typeof payload.title === "string" ? payload.title : undefined;

				if (command.status === "pending") {
					return {
						eventId,
						eventStatus: "pending",
						eventTitle,
						appliedAtTick: null,
						currentTick,
						ticksSinceEvent: null,
						priceChanges: [],
						volumeSummary: { totalTrades: 0, totalVolume: 0 },
						notableActions: [],
						message: `Event "${eventTitle ?? eventId}" is still pending in the command queue. It has not been applied yet, so there is no aftermath to observe. Current tick: ${currentTick}.`,
					};
				}

				if (command.status === "rejected") {
					return {
						eventId,
						eventStatus: "rejected",
						eventTitle,
						appliedAtTick: null,
						currentTick,
						ticksSinceEvent: null,
						priceChanges: [],
						volumeSummary: { totalTrades: 0, totalVolume: 0 },
						notableActions: [],
						message:
							command.resultMessage ??
							`Event "${eventTitle ?? eventId}" was rejected before it could be applied.`,
					};
				}

				return {
					eventId,
					eventStatus: "processing",
					eventTitle,
					appliedAtTick: null,
					currentTick,
					ticksSinceEvent: null,
					priceChanges: [],
					volumeSummary: { totalTrades: 0, totalVolume: 0 },
					notableActions: [],
					message: `Event "${eventTitle ?? eventId}" has been processed by the command queue but is not visible in the event log yet. Ask again in a few ticks.`,
				};
			}

			return {
				eventId,
				eventStatus: "not_found",
				eventTitle: undefined,
				appliedAtTick: null,
				currentTick: 0,
				ticksSinceEvent: null,
				priceChanges: [],
				volumeSummary: { totalTrades: 0, totalVolume: 0 },
				notableActions: [],
				message: `No event found with eventId "${eventId}". It may still be processing or the ID is incorrect.`,
			};
		}

		const currentTick = await loadCurrentTick();

		if (event.status === "queued") {
			return {
				eventId,
				eventStatus: event.status,
				eventTitle: event.title,
				appliedAtTick: null,
				currentTick,
				ticksSinceEvent: null,
				priceChanges: [],
				volumeSummary: { totalTrades: 0, totalVolume: 0 },
				notableActions: [],
				message: `Event "${event.title}" is still queued. It will be applied at the next tick boundary. Current tick: ${currentTick}.`,
			};
		}

		if (event.status === "rejected") {
			return {
				eventId,
				eventStatus: event.status,
				eventTitle: event.title,
				appliedAtTick: event.appliedAtTick,
				currentTick,
				ticksSinceEvent: null,
				priceChanges: [],
				volumeSummary: { totalTrades: 0, totalVolume: 0 },
				notableActions: [],
				message: `Event "${event.title}" was rejected by the simulation worker.`,
			};
		}

		const appliedTick = event.appliedAtTick ?? 0;
		const ticksSinceEvent = currentTick - appliedTick;

		const affectedSymbols: string[] = (event.affectedSymbols as string[]) ?? [];

		const priceChanges: Array<{
			symbol: string;
			priceBefore: number | null;
			priceAfter: number | null;
			changePct: number | null;
		}> = [];

		for (const symbol of affectedSymbols) {
			const beforeRows = await db
				.select({ close: ticks.close })
				.from(ticks)
				.where(
					and(
						eq(ticks.sessionId, sessionId),
						eq(ticks.symbol, symbol),
						eq(ticks.tick, appliedTick),
					),
				)
				.limit(1);

			const afterRows = await db
				.select({ close: ticks.close })
				.from(ticks)
				.where(
					and(
						eq(ticks.sessionId, sessionId),
						eq(ticks.symbol, symbol),
						eq(ticks.tick, currentTick),
					),
				)
				.limit(1);

			const priceBefore = beforeRows[0]?.close ?? null;
			const priceAfter = afterRows[0]?.close ?? null;
			const changePct =
				priceBefore && priceAfter
					? ((priceAfter - priceBefore) / priceBefore) * 100
					: null;

			priceChanges.push({ symbol, priceBefore, priceAfter, changePct });
		}

		const tradeRows = await db
			.select({
				id: trades.id,
				quantity: trades.quantity,
			})
			.from(trades)
			.where(
				and(
					eq(trades.sessionId, sessionId),
					sql`${trades.tick} >= ${appliedTick}`,
				),
			);

		const volumeSummary = {
			totalTrades: tradeRows.length,
			totalVolume: tradeRows.reduce((sum, t) => sum + t.quantity, 0),
		};

		const actionRows = await db
			.select({
				agentId: orders.agentId,
				side: orders.side,
				symbol: orders.symbol,
				quantity: orders.quantity,
				llmReasoning: orders.llmReasoning,
			})
			.from(orders)
			.where(
				and(
					eq(orders.sessionId, sessionId),
					sql`${orders.tick} >= ${appliedTick}`,
					sql`${orders.llmReasoning} IS NOT NULL`,
				),
			)
			.orderBy(desc(orders.tick))
			.limit(10);

		const agentIds = [...new Set(actionRows.map((a) => a.agentId))];
		const agentNameMap = new Map<string, string>();
		if (agentIds.length > 0) {
			const agentRows = await db
				.select({ id: agents.id, name: agents.name })
				.from(agents)
				.where(
					and(
						eq(agents.sessionId, sessionId),
						sql`${agents.id} = ANY(${agentIds})`,
					),
				);
			for (const row of agentRows) {
				agentNameMap.set(row.id, row.name);
			}
		}

		const notableActions = actionRows.map((a) => ({
			agentId: a.agentId,
			agentName: agentNameMap.get(a.agentId),
			side: a.side,
			symbol: a.symbol,
			qty: a.quantity,
			reasoning: a.llmReasoning,
		}));

		const priceSummary = priceChanges
			.filter((p) => p.changePct !== null)
			.map((p) => {
				const val = p.changePct as number;
				return `${p.symbol}: ${val >= 0 ? "+" : ""}${val.toFixed(2)}%`;
			})
			.join("; ");

		return {
			eventId,
			eventStatus: event.status,
			eventTitle: event.title,
			appliedAtTick: appliedTick,
			currentTick,
			ticksSinceEvent,
			priceChanges,
			volumeSummary,
			notableActions,
			message:
				ticksSinceEvent <= 0
					? `Event "${event.title}" was just applied at tick ${appliedTick}. No post-event data yet. Ask again after a few ticks elapse.`
					: `After ${ticksSinceEvent} tick${ticksSinceEvent === 1 ? "" : "s"} since "${event.title}": ${priceSummary || "no price data yet"}. ${volumeSummary.totalTrades} trades, ${volumeSummary.totalVolume} total volume.`,
		};
	},
});
