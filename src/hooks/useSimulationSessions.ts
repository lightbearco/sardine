import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createSimulationSessionInputSchema } from "#/lib/simulation-session";
import {
	createSimulationSession,
	deleteSimulationSession,
	getSessionDashboardHydration,
	getSessionSymbolHydration,
	listSimulationSessions,
} from "#/server/sessions";

const sessionDashboardInputSchema = z.object({
	sessionId: z.string().min(1),
	symbol: z.string().optional(),
});

const sessionSymbolInputSchema = z.object({
	sessionId: z.string().min(1),
	symbol: z.string().min(1),
});

const deleteSimulationSessionInputSchema = z.object({
	sessionId: z.string().min(1),
});

export const listSimulationSessionsFn = createServerFn({
	method: "GET",
}).handler(async () => listSimulationSessions());

export const createSimulationSessionFn = createServerFn({ method: "POST" })
	.inputValidator((data: z.infer<typeof createSimulationSessionInputSchema>) =>
		createSimulationSessionInputSchema.parse(data),
	)
	.handler(async ({ data }) => createSimulationSession(data));

export const deleteSimulationSessionFn = createServerFn({ method: "POST" })
	.inputValidator((data: z.infer<typeof deleteSimulationSessionInputSchema>) =>
		deleteSimulationSessionInputSchema.parse(data),
	)
	.handler(async ({ data }) => deleteSimulationSession(data.sessionId));

export const getSessionDashboardFn = createServerFn({ method: "GET" })
	.inputValidator((data: z.infer<typeof sessionDashboardInputSchema>) =>
		sessionDashboardInputSchema.parse(data),
	)
	.handler(async ({ data }) => getSessionDashboardHydration(data));

export const getSessionSymbolFn = createServerFn({ method: "POST" })
	.inputValidator((data: z.infer<typeof sessionSymbolInputSchema>) =>
		sessionSymbolInputSchema.parse(data),
	)
	.handler(async ({ data }) => getSessionSymbolHydration(data));
