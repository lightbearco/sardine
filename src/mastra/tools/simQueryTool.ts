import { createTool } from "@mastra/core/tools";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db/index";
import { agents, orders, simConfig, ticks, trades } from "#/db/schema";

const simQueryInputSchema = z.object({
	sessionId: z.string().min(1),
	query: z.enum([
		"agent_rankings",
		"recent_trades",
		"price_history",
		"agent_decisions",
		"sim_status",
	]),
	symbol: z.string().optional(),
	agentId: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional(),
	ticksBack: z.number().int().min(1).max(500).optional(),
});

const simQueryOutputSchema = z.object({
	query: z.string(),
	result: z.record(z.string(), z.unknown()),
});

export const simQueryTool = createTool<
	"sim-query",
	typeof simQueryInputSchema,
	typeof simQueryOutputSchema
>({
	id: "sim-query",
	description:
		"Query simulation state: agent performance rankings, recent trades, price history, agent decisions with LLM reasoning, and simulation status. All queries are read-only.",
	inputSchema: simQueryInputSchema,
	outputSchema: simQueryOutputSchema,
	execute: async (input) => {
		const { sessionId, query } = input;
		const limit = input.limit ?? 10;

		switch (query) {
			case "agent_rankings": {
				const rows = await db
					.select({
						id: agents.id,
						name: agents.name,
						tier: agents.tier,
						strategyType: agents.strategyType,
						startingCapital: agents.startingCapital,
						currentNav: agents.currentNav,
						currentCash: agents.currentCash,
						pnl: sql<number>`${agents.currentNav} - ${agents.startingCapital}`,
					})
					.from(agents)
					.where(eq(agents.sessionId, sessionId))
					.orderBy(desc(sql`${agents.currentNav} - ${agents.startingCapital}`))
					.limit(limit);

				return {
					query,
					result: {
						rankings: rows.map((row, index) => ({
							rank: index + 1,
							...row,
							pnl: Number(row.pnl),
						})),
					},
				};
			}

			case "recent_trades": {
				const conditions = [eq(trades.sessionId, sessionId)];
				if (input.symbol) {
					conditions.push(eq(trades.symbol, input.symbol));
				}

				const rows = await db
					.select({
						id: trades.id,
						tick: trades.tick,
						symbol: trades.symbol,
						price: trades.price,
						quantity: trades.quantity,
						buyerAgentId: trades.buyerAgentId,
						sellerAgentId: trades.sellerAgentId,
						createdAt: trades.createdAt,
					})
					.from(trades)
					.where(and(...conditions))
					.orderBy(desc(trades.tick), desc(trades.createdAt))
					.limit(limit);

				return {
					query,
					result: { trades: rows },
				};
			}

			case "price_history": {
				if (!input.symbol) {
					return {
						query,
						result: {
							error: "symbol is required for price_history query",
						},
					};
				}

				const ticksBack = input.ticksBack ?? 20;

				const configRow = await db
					.select({ currentTick: simConfig.currentTick })
					.from(simConfig)
					.where(eq(simConfig.sessionId, sessionId))
					.limit(1);

				const currentTick = configRow[0]?.currentTick ?? 0;

				const rows = await db
					.select({
						tick: ticks.tick,
						symbol: ticks.symbol,
						open: ticks.open,
						high: ticks.high,
						low: ticks.low,
						close: ticks.close,
						volume: ticks.volume,
					})
					.from(ticks)
					.where(
						and(eq(ticks.sessionId, sessionId), eq(ticks.symbol, input.symbol)),
					)
					.orderBy(desc(ticks.tick))
					.limit(ticksBack);

				return {
					query,
					result: {
						symbol: input.symbol,
						currentTick,
						bars: rows.reverse(),
					},
				};
			}

			case "agent_decisions": {
				const conditions = [eq(orders.sessionId, sessionId)];
				if (input.agentId) {
					conditions.push(eq(orders.agentId, input.agentId));
				}

				const rows = await db
					.select({
						id: orders.id,
						tick: orders.tick,
						agentId: orders.agentId,
						symbol: orders.symbol,
						side: orders.side,
						type: orders.type,
						price: orders.price,
						quantity: orders.quantity,
						status: orders.status,
						filledQuantity: orders.filledQuantity,
						llmReasoning: orders.llmReasoning,
						createdAt: orders.createdAt,
					})
					.from(orders)
					.where(and(...conditions))
					.orderBy(desc(orders.tick), desc(orders.createdAt))
					.limit(limit);

				return {
					query,
					result: { orders: rows },
				};
			}

			case "sim_status": {
				const rows = await db
					.select({
						isRunning: simConfig.isRunning,
						currentTick: simConfig.currentTick,
						simulatedMarketTime: simConfig.simulatedMarketTime,
						speedMultiplier: simConfig.speedMultiplier,
						tickIntervalMs: simConfig.tickIntervalMs,
					})
					.from(simConfig)
					.where(eq(simConfig.sessionId, sessionId))
					.limit(1);

				return {
					query,
					result: { simConfig: rows[0] ?? null },
				};
			}
		}
	},
});
