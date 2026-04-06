import { createFileRoute } from "@tanstack/react-router";
import { chatbotAgent } from "#/mastra/agents/chatbot-agent";

interface ChatRequest {
	messages: Array<{ role: string; content: string }>;
	sessionId?: string;
}

type AgentMessage =
	| { role: "user"; content: string }
	| { role: "assistant"; content: string };

function buildAgentMessages(
	messages: Array<{ role: string; content: string }>,
	sessionId?: string,
): AgentMessage[] {
	const mapped: AgentMessage[] = messages.map((m) => {
		if (m.role === "user") {
			return { role: "user" as const, content: m.content };
		}
		return { role: "assistant" as const, content: m.content };
	});

	if (sessionId) {
		const hasSessionContext = mapped.some((m) =>
			m.content.includes("sessionId"),
		);
		if (!hasSessionContext) {
			const lastUserIdx = [...mapped]
				.reverse()
				.findIndex((m) => m.role === "user");
			if (lastUserIdx !== -1) {
				const realIdx = mapped.length - 1 - lastUserIdx;
				const existing = mapped[realIdx];
				if (existing.role === "user") {
					mapped[realIdx] = {
						role: "user",
						content: `${existing.content}\n\n[sessionId: ${sessionId}]`,
					};
				}
			}
		}
	}

	return mapped;
}

export const Route = createFileRoute("/api/chat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const body: unknown = await request.json();
				const parsed = body as ChatRequest;

				if (
					!parsed.messages ||
					!Array.isArray(parsed.messages) ||
					parsed.messages.length === 0
				) {
					return new Response(JSON.stringify({ error: "messages required" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}

				const agentMessages = buildAgentMessages(
					parsed.messages,
					parsed.sessionId,
				);

				const result = await chatbotAgent.stream(agentMessages, {
					maxSteps: 5,
				});

				const encoder = new TextEncoder();
				const readable = new ReadableStream({
					async start(controller) {
						try {
							for await (const chunk of result.textStream) {
								controller.enqueue(
									encoder.encode(
										`data: ${JSON.stringify({ text: chunk })}\n\n`,
									),
								);
							}
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`),
							);
							controller.close();
						} catch (err) {
							const msg = err instanceof Error ? err.message : "Stream error";
							controller.enqueue(
								encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
							);
							controller.close();
						}
					},
				});

				return new Response(readable, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					},
				});
			},
		},
	},
});
