import Decimal from "decimal.js";
import type { AgentRegistryEntry } from "#/agents/AgentRegistry";
import type { MatchingEngine } from "#/engine/lob/MatchingEngine";
import type { ResearchNote } from "#/types/research";

export interface TickPromptDeps {
	matchingEngine: MatchingEngine;
	getReleasedNotesForAgent: (entry: AgentRegistryEntry) => ResearchNote[];
}

export function buildTickPrompt(
	deps: TickPromptDeps,
	entry: AgentRegistryEntry,
	simTick: number,
	simulatedTime: Date,
	releasedThisTick: ResearchNote[] = [],
): string {
	const { matchingEngine, getReleasedNotesForAgent } = deps;

	const notes = getReleasedNotesForPrompt(
		getReleasedNotesForAgent(entry),
		releasedThisTick,
	).slice(0, 3);
	const noteSummary =
		notes.length === 0
			? "No new research notes were released to you this tick."
			: notes
					.map(
						(note) =>
							`- ${note.headline} (${note.sentiment}, confidence ${note.confidence}) on ${note.symbols.join(", ")}`,
					)
					.join("\n");

	const capital = entry.config.capital;
	const cash = entry.state.cash;
	const nav = entry.state.nav;
	const totalPnl = nav.minus(capital);
	const pnlPct =
		capital > 0
			? totalPnl.div(capital).times(100).toDecimalPlaces(2).toString()
			: "0";

	let portfolioSummary = `Cash: $${cash.toDecimalPlaces(2).toString()} | NAV: $${nav.toDecimalPlaces(2).toString()} | P&L: $${totalPnl.toDecimalPlaces(2).toString()} (${pnlPct}%)`;

	const positions = Array.from(entry.state.positions.entries());
	if (positions.length > 0) {
		const refPrices = matchingEngine.getReferencePrices();
		const positionLines = positions.map(([symbol, pos]) => {
			const refPrice = refPrices.get(symbol);
			const markPrice = refPrice ?? pos.avgCost;
			const marketValue = markPrice.times(pos.qty);
			const weightPct = nav.gt(0)
				? marketValue.div(nav).times(100).toDecimalPlaces(2).toString()
				: "0";
			const unrealizedPnl = markPrice.minus(pos.avgCost).times(pos.qty);
			const realizedPnl = entry.state.realizedPnl.get(symbol) ?? new Decimal(0);
			return `${symbol}: ${pos.qty} shares @ $${pos.avgCost.toDecimalPlaces(2)} | Mark $${markPrice.toDecimalPlaces(2)} | MV $${marketValue.toDecimalPlaces(2)} (${weightPct}%) | Unrealized $${unrealizedPnl.toDecimalPlaces(2)} | Realized $${realizedPnl.toDecimalPlaces(2)}`;
		});
		portfolioSummary += `\n\nPositions (${positions.length}):\n${positionLines.join("\n")}`;
	} else {
		portfolioSummary += "\n\nNo open positions.";
	}

	const openOrderCount = entry.state.openOrders.size;
	if (openOrderCount > 0) {
		portfolioSummary += `\n\nOpen orders: ${openOrderCount}`;
	}

	const fills = entry.state.pendingFills;
	let fillSummary = "";
	if (fills.length > 0) {
		const fillLines = fills.map((fill) => {
			const side = fill.buyerAgentId === entry.config.id ? "BUY" : "SELL";
			return `- ${side} ${fill.qty} ${fill.symbol} @ $${fill.price.toDecimalPlaces(2)} (tick ${fill.tick})`;
		});
		fillSummary = `Fills since your last turn:\n${fillLines.join("\n")}`;
	}

	const previousTurnSummary = buildPreviousTurnSummary(
		entry.state.lastLlmTick,
		simTick,
		entry.state.lastAutopilotDirective,
	);

	const parts = [
		`Simulation tick: ${simTick}`,
		`Simulated market time: ${simulatedTime.toISOString()}`,
		"Your portfolio:",
		portfolioSummary,
	];

	if (fillSummary) {
		parts.push(fillSummary);
	}

	parts.push(previousTurnSummary);

	parts.push(
		"Recent released research:",
		noteSummary,
		"Decide whether to trade this tick. Use tools when you need market data, additional portfolio context, or to stage an order.",
	);

	const prompt = parts.join("\n\n");

	entry.state.pendingFills = [];

	return prompt;
}

function buildPreviousTurnSummary(
	lastLlmTick: number | null,
	currentTick: number,
	directive: import("#/types/agent").AutopilotDirective | null,
): string {
	if (lastLlmTick === null) {
		return "Previous turn context: This is your first LLM turn — no previous tick on record.";
	}

	const ticksAgo = currentTick - lastLlmTick;
	const lines = [
		`Previous turn context: Your last LLM turn was tick ${lastLlmTick} (${ticksAgo} tick${ticksAgo === 1 ? "" : "s"} ago).`,
	];

	if (directive) {
		if (directive.standingOrders.length > 0) {
			const orderLines = directive.standingOrders.map(
				(o) =>
					`  - ${o.side.toUpperCase()} ${o.qty} ${o.symbol}${o.type === "limit" && o.price != null ? ` @ $${o.price}` : ""} (${o.type})`,
			);
			lines.push(`Standing orders:\n${orderLines.join("\n")}`);
		}

		if (directive.holdPositions.length > 0) {
			lines.push(`Holding: ${directive.holdPositions.join(", ")}`);
		}

		if (directive.cancelIf) {
			lines.push(
				`Cancel if: ${directive.cancelIf.symbol} ${directive.cancelIf.condition}`,
			);
		}

		if (directive.urgentReviewIf) {
			lines.push(
				`Urgent review if: ${directive.urgentReviewIf.symbol} ${directive.urgentReviewIf.condition}`,
			);
		}
	}

	return lines.join("\n");
}

function getReleasedNotesForPrompt(
	inboxNotes: ResearchNote[],
	releasedThisTick: ResearchNote[],
): ResearchNote[] {
	if (releasedThisTick.length === 0) {
		return inboxNotes;
	}

	const merged = new Map<string, ResearchNote>();
	for (const note of releasedThisTick) {
		merged.set(note.id, note);
	}
	for (const note of inboxNotes) {
		if (!merged.has(note.id)) {
			merged.set(note.id, note);
		}
	}

	return Array.from(merged.values()).sort(
		(left, right) => right.publishedAtTick - left.publishedAtTick,
	);
}
