import type { RequestContext } from "@mastra/core/request-context";
import Decimal from "decimal.js";
import pLimit from "p-limit";
import { z } from "zod";
import type { AgentRegistry, AgentRegistryEntry } from "#/agents/AgentRegistry";
import { createLogger } from "#/lib/logger";
import type { MatchingEngine } from "#/engine/lob/MatchingEngine";
import {
	type TradingDecision,
	tradingDecisionSchema,
} from "#/mastra/agents/trading-agent";
import { TRADING_MODEL } from "#/mastra/models";
import {
	cloneTradingRequestContext,
	type TradingRequestContextValues,
} from "#/mastra/trading-context";
import type { ResearchNote } from "#/types/research";
import type {
	AgentDecisionEvent,
	AgentDecisionOrder,
	AgentEvent,
	AgentFailureReason,
	AgentFailedEvent,
	AgentSignal,
	AgentSignalEvent,
	AgentThinkingDelta,
	StagedOrderResult,
} from "#/types/sim";
import type { TickPromptDeps } from "./tick-prompt";

const log = createLogger("active-agent-runner");

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

export interface ActiveAgentOutcome {
	stagedOrders: StagedOrderResult[];
}

export class ActiveAgentGenerationError extends Error {
	constructor(
		message: string,
		public readonly failureReason: AgentFailureReason,
		public readonly transcript: string,
	) {
		super(message);
		this.name = "ActiveAgentGenerationError";
	}
}

export interface ActiveAgentRunnerDeps {
	tradingAgent: TradingAgentLike;
	agentRegistry: AgentRegistry;
	matchingEngine: MatchingEngine;
	sessionId: string;
	llmConcurrency: number;
	llmTimeoutMs: number;
	buildTickPrompt: (
		deps: TickPromptDeps,
		entry: AgentRegistryEntry,
		simTick: number,
		simulatedTime: Date,
		releasedThisTick: ResearchNote[],
	) => string;
	getReleasedNotesForAgent: (agentId: string) => ResearchNote[];
	emitAndCollectAgentEvent: (
		agentEvents: AgentEvent[],
		event: Omit<AgentEvent, "eventId">,
	) => AgentEvent;
	emitThinkingDelta: (delta: AgentThinkingDelta) => void;
}

type ReleasedResearchByAgent = Map<string, ResearchNote[]>;

export async function runActiveAgents(
	deps: ActiveAgentRunnerDeps,
	activeEntries: AgentRegistryEntry[],
	simTick: number,
	simulatedTime: Date,
	changedAgentIds: Set<string>,
	releasedNotesByAgent: ReleasedResearchByAgent,
	agentEvents: AgentEvent[],
): Promise<ActiveAgentOutcome> {
	const limit = pLimit(deps.llmConcurrency);
	const tasks = activeEntries.map((entry) =>
		limit(() =>
			generateForActiveAgent(
				deps,
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

		const failure = normalizeActiveAgentFailure(settled.reason);
		const fallbackDirective = buildFallbackDirective(entry);
		log.error(
			{
				agentName: entry.config.name,
				agentId: entry.config.id,
				simTick,
				reason: failure.message,
			},
			"LLM generation failed for agent",
		);
		entry.state.lastAutopilotDirective = fallbackDirective;
		entry.state.lastLlmTick = simTick;
		changedAgentIds.add(entry.config.id);
		deps.emitAndCollectAgentEvent(agentEvents, {
			type: "failed",
			agentId: entry.config.id,
			agentName: entry.config.name,
			tick: simTick,
			reason: failure.reason,
			message: failure.message,
			transcript: failure.transcript,
			fallbackDirective,
		} as Omit<AgentFailedEvent, "eventId">);
	}

	return { stagedOrders };
}

async function generateForActiveAgent(
	deps: ActiveAgentRunnerDeps,
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
	requestContext.set("agent-registry", deps.agentRegistry);
	requestContext.set("matching-engine", deps.matchingEngine);
	requestContext.set("sim-tick", simTick);
	requestContext.set(
		"released-research-notes",
		deps.getReleasedNotesForAgent(entry.config.id),
	);

	const promptDeps: TickPromptDeps = {
		matchingEngine: deps.matchingEngine,
		getReleasedNotesForAgent: (e) => deps.getReleasedNotesForAgent(e.config.id),
	};
	const prompt = deps.buildTickPrompt(
		promptDeps,
		entry,
		simTick,
		simulatedTime,
		releasedThisTick,
	);
	deps.emitAndCollectAgentEvent(agentEvents, {
		type: "run_started",
		agentId: entry.config.id,
		agentName: entry.config.name,
		tick: simTick,
	});

	let transcript = "";

	try {
		const stream = await streamWithTimeout(deps, prompt, requestContext);
		const consumeThinkingPromise = consumeAgentThinkingStream(
			stream.fullStream,
			entry,
			simTick,
			deps.emitThinkingDelta,
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
		deps.emitAndCollectAgentEvent(agentEvents, decisionEvent);

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

			deps.emitAndCollectAgentEvent(agentEvents, {
				type: "signal",
				agentId: entry.config.id,
				agentName: entry.config.name,
				tick: simTick,
				signal,
			} as Omit<AgentSignalEvent, "eventId">);
		}

		return { decision, orders };
	} catch (error) {
		throw classifyActiveAgentFailure(error, transcript);
	}
}

async function streamWithTimeout(
	deps: ActiveAgentRunnerDeps,
	prompt: string,
	requestContext: ReturnType<typeof cloneTradingRequestContext>,
): Promise<TradingAgentStreamLike> {
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => {
		controller.abort("LLM generation timed out");
	}, deps.llmTimeoutMs);

	try {
		return await deps.tradingAgent.stream(prompt, {
			resourceId: deps.sessionId,
			requestContext,
			maxSteps: 15,
			abortSignal: controller.signal,
			structuredOutput: {
				schema: tradingDecisionSchema,
				model: TRADING_MODEL,
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

async function consumeAgentThinkingStream(
	fullStream: AsyncIterable<unknown>,
	entry: AgentRegistryEntry,
	simTick: number,
	emitThinkingDelta: ActiveAgentRunnerDeps["emitThinkingDelta"],
	onDelta: (delta: string) => void,
): Promise<void> {
	let transcript = "";

	for await (const chunk of fullStream) {
		const delta = extractAgentThinkingDelta(chunk);
		if (!delta) {
			continue;
		}

		transcript += delta;
		onDelta(delta);
		emitThinkingDelta({
			agentId: entry.config.id,
			agentName: entry.config.name,
			tick: simTick,
			delta,
			transcript,
		});
	}
}

function extractAgentThinkingDelta(chunk: unknown): string | null {
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

function classifyActiveAgentFailure(
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

	if (error instanceof z.ZodError || isSchemaValidationError(error)) {
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

function normalizeActiveAgentFailure(error: unknown): {
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
			reason: isSchemaValidationError(error)
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

function isSchemaValidationError(error: unknown): boolean {
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

function buildFallbackDirective(
	entry: AgentRegistryEntry,
): TradingDecision["autopilotDirective"] {
	return {
		standingOrders: [],
		holdPositions: Array.from(entry.state.positions.keys()),
	};
}
