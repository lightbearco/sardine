import { createTool } from "@mastra/core/tools";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db } from "#/db/index";
import { commands } from "#/db/schema";

const eventInjectionInputSchema = z.object({
	sessionId: z.string().min(1),
	type: z.enum([
		"rate_decision",
		"earnings",
		"news",
		"lawsuit",
		"regulatory",
		"macro",
		"geopolitical",
		"sector_rotation",
		"custom",
	]),
	title: z.string().min(1).max(200),
	magnitude: z.number().min(-1).max(1),
	affectedSymbols: z.array(z.string().min(1)).min(1),
	description: z.string().max(500).optional(),
	duration: z.number().int().min(1).optional(),
});

const eventInjectionOutputSchema = z.object({
	eventId: z.string(),
	commandId: z.number(),
	status: z.string(),
	message: z.string(),
});

export const eventInjectionTool = createTool<
	"event-injection",
	typeof eventInjectionInputSchema,
	typeof eventInjectionOutputSchema
>({
	id: "event-injection",
	description:
		"Inject a world event into the running simulation. The event is queued as a pending command and will be applied at the next tick boundary by the simulation worker. Returns an eventId for tracking.",
	inputSchema: eventInjectionInputSchema,
	outputSchema: eventInjectionOutputSchema,
	execute: async (input) => {
		const eventId = nanoid();
		const payload = {
			eventId,
			type: input.type,
			title: input.title,
			magnitude: input.magnitude,
			affectedSymbols: input.affectedSymbols,
			source: "chatbot" as const,
			description: input.description ?? input.title,
			duration: input.duration,
			payload: {},
		};

		const [row] = await db
			.insert(commands)
			.values({
				sessionId: input.sessionId,
				type: "inject_world_event",
				payload,
				status: "pending",
			})
			.returning({ id: commands.id });

		return {
			eventId,
			commandId: row.id,
			status: "pending",
			message: `Event "${input.title}" queued. It will be applied at the next tick boundary. Use the wait-and-observe tool with eventId "${eventId}" to check the aftermath.`,
		};
	},
});
