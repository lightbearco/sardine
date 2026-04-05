import type { MastraModelConfig } from "@mastra/core/llm";
import type Decimal from "decimal.js";
import type { Order } from "#/types/market";
import type { ResearchNote } from "#/types/research";

// ── Agent Tiers ──

export type AgentTier = "tier1" | "tier2" | "tier3" | "research" | "strategy";
export type AgentStatus = "active" | "paused" | "liquidated";

// ── Position ──

export interface Position {
	qty: number;
	avgCost: Decimal;
}

// ── Autopilot Directive ──
// Structured instructions for ticks when the agent has no LLM access.

export interface AutopilotStandingOrder {
	symbol: string;
	side: "buy" | "sell";
	type: "market" | "limit";
	price?: number;
	qty: number;
}

export interface AutopilotDirective {
	standingOrders: AutopilotStandingOrder[];
	holdPositions: string[];
	cancelIf?: { symbol: string; condition: string };
	urgentReviewIf?: { symbol: string; condition: string };
}

// ── Agent Config ──
// Static configuration generated at bootstrap.

export interface AgentConfig {
	id: string;
	name: string;
	tier: AgentTier;
	entityType: string;
	strategy: string;
	persona: string;
	currentAgenda: string;
	investmentThesis: string;
	quarterlyGoal: string;
	personalityTraits: string[];
	behavioralBiases: string[];
	constraints: string[];
	restrictedSymbols: string[];
	sectors: string[];
	risk: number;
	capital: number;
	model: MastraModelConfig;
	llmGroup: number;
	decisionParams: Record<string, number>;
}

// ── Agent State ──
// Mutable runtime state tracked per agent.

export interface AgentState {
	id: string;
	name: string;
	tier: AgentTier;
	status: AgentStatus;
	strategy: string;
	llmGroup: number;
	cash: Decimal;
	nav: Decimal;
	positions: Map<string, Position>;
	openOrders: Map<string, Order>;
	researchInbox: Map<string, ResearchNote>;
	lastAutopilotDirective: AutopilotDirective | null;
	lastLlmTick: number | null;
}

export interface AutopilotExecutionResult {
	orders: Order[];
	cancelOrderIds: string[];
	urgentReview: boolean;
}
