import { useEffect, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Decimal from "decimal.js";
import { db } from "#/db/index";
import { commands } from "#/db/schema";
import type { Trade, TradeData } from "#/types/market";
import { buildSessionChannel } from "#/types/ws";
import type {
	SimRuntimeState,
	SimRuntimeStateData,
	TickSummary,
	TickSummaryData,
} from "#/types/sim";
import { useSimWebSocket } from "./useSimWebSocket";
import { useSessionDashboard } from "./useSessionDashboard";

const commandInputSchema = z.object({
	sessionId: z.string().min(1),
});

export const playSimFn = createServerFn({ method: "POST" })
	.inputValidator((data: z.infer<typeof commandInputSchema>) =>
		commandInputSchema.parse(data),
	)
	.handler(async ({ data }) => {
		await db.insert(commands).values({ sessionId: data.sessionId, type: "start" });
	});

export const pauseSimFn = createServerFn({ method: "POST" })
	.inputValidator((data: z.infer<typeof commandInputSchema>) =>
		commandInputSchema.parse(data),
	)
	.handler(async ({ data }) => {
		await db.insert(commands).values({ sessionId: data.sessionId, type: "pause" });
	});

export const stepSimFn = createServerFn({ method: "POST" })
	.inputValidator((data: z.infer<typeof commandInputSchema>) =>
		commandInputSchema.parse(data),
	)
	.handler(async ({ data }) => {
		await db.insert(commands).values({ sessionId: data.sessionId, type: "step" });
	});

const setSpeedSchema = z.object({
	sessionId: z.string().min(1),
	speedMultiplier: z.number().positive(),
});

export const setSpeedSimFn = createServerFn({ method: "POST" })
	.inputValidator((data: z.infer<typeof setSpeedSchema>) =>
		setSpeedSchema.parse(data),
	)
	.handler(async ({ data }) => {
		await db.insert(commands).values({
			sessionId: data.sessionId,
			type: "set_speed",
			payload: { speedMultiplier: data.speedMultiplier },
		});
	});

export function useSimControls() {
	const { subscribe, isConnected } = useSimWebSocket();
	const { isLive, sessionId, simState: initialState } = useSessionDashboard();
	const [simState, setSimState] = useState<SimRuntimeState | null>(
		convertRuntimeState(initialState),
	);

	useEffect(() => {
		setSimState(convertRuntimeState(initialState));
	}, [initialState]);

	useEffect(() => {
		if (!isLive) {
			return;
		}

		const unsubscribe = subscribe(
			buildSessionChannel("sim", sessionId),
			(state: SimRuntimeState) => {
			setSimState(state);
			},
		);

		return unsubscribe;
	}, [isLive, sessionId, subscribe]);

	return {
		simState,
		isLive,
		isConnected,
		play: async () => playSimFn({ data: { sessionId } }),
		pause: async () => pauseSimFn({ data: { sessionId } }),
		step: async () => stepSimFn({ data: { sessionId } }),
		setSpeed: async (speedMultiplier: number) =>
			setSpeedSimFn({ data: { sessionId, speedMultiplier } }),
	};
}

function convertRuntimeState(
	state: SimRuntimeStateData | null,
): SimRuntimeState | null {
	if (!state) {
		return null;
	}

	return {
		...state,
		lastSummary: state.lastSummary
			? convertTickSummaryData(state.lastSummary)
			: null,
	};
}

function convertTickSummaryData(summary: TickSummaryData): TickSummary {
	return {
		...summary,
		trades: summary.trades.map(convertTradeData),
	};
}

function convertTradeData(trade: TradeData): Trade {
	return {
		...trade,
		price: new Decimal(trade.price),
	};
}
