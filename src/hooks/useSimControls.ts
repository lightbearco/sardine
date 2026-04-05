import { useEffect, useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "#/db/index";
import { commands } from "#/db/schema";
import type { SimRuntimeState } from "#/types/sim";
import { useSimWebSocket } from "./useSimWebSocket";

export const playSimFn = createServerFn({ method: "POST" }).handler(async () => {
	await db.insert(commands).values({ type: "start" });
});

export const pauseSimFn = createServerFn({ method: "POST" }).handler(async () => {
	await db.insert(commands).values({ type: "pause" });
});

export const stepSimFn = createServerFn({ method: "POST" }).handler(async () => {
	await db.insert(commands).values({ type: "step" });
});

const setSpeedSchema = z.object({
	speedMultiplier: z.number().positive(),
});

export const setSpeedSimFn = createServerFn({ method: "POST" })
	.inputValidator((data: z.infer<typeof setSpeedSchema>) =>
		setSpeedSchema.parse(data),
	)
	.handler(async ({ data }) => {
		await db.insert(commands).values({
			type: "set_speed",
			payload: { speedMultiplier: data.speedMultiplier },
		});
	});

export function useSimControls(initialState: SimRuntimeState | null = null) {
	const { subscribe, isConnected } = useSimWebSocket();
	const [simState, setSimState] = useState<SimRuntimeState | null>(initialState);

	useEffect(() => {
		const unsubscribe = subscribe("sim", (state: SimRuntimeState) => {
			setSimState(state);
		});

		return unsubscribe;
	}, [subscribe]);

	return {
		simState,
		isConnected,
		play: async () => playSimFn(),
		pause: async () => pauseSimFn(),
		step: async () => stepSimFn(),
		setSpeed: async (speedMultiplier: number) =>
			setSpeedSimFn({ data: { speedMultiplier } }),
	};
}
