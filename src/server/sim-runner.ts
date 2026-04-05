import Decimal from "decimal.js";
import { generateAgentConfigs, spawnAgents } from "#/agents/factory";
import { serializeAgentEntriesForDb } from "#/agents/persistence";
import { db } from "#/db/index";
import {
	agents as agentsTable,
	commands as commandsTable,
	orders as ordersTable,
	trades as tradesTable,
	ticks as ticksTable,
	simConfig as simConfigTable,
} from "#/db/schema";
import { EventBus } from "#/engine/bus/EventBus";
import { PublicationBus } from "#/engine/bus/PublicationBus";
import { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SimClock } from "#/engine/sim/SimClock";
import { SimOrchestrator } from "#/engine/sim/SimOrchestrator";
import { DEV_TICKERS, SIM_DEFAULTS } from "#/lib/constants";
import type { Order } from "#/types/market";
import { tradingAgent } from "#/mastra/agents/trading-agent";
import { broadcaster } from "./ws/broadcaster";
import { startSimWebSocketServer } from "./ws/SimWebSocketServer";

async function main() {
	// Bootstrap: initialize symbols, seed order books, spawn agents
	const symbols = DEV_TICKERS.map((t) => t.symbol);

	const matchingEngine = new MatchingEngine();
	matchingEngine.initialize(symbols);
	const seedOrders: Order[] = [];
	for (const symbol of symbols) {
		seedOrders.push(
			...matchingEngine.seedBook(symbol, new Decimal(150), new Decimal("0.10"), 5, 100, 0),
		);
	}

	const agentCount = Number(process.env.SIM_AGENT_COUNT) || SIM_DEFAULTS.agentCount;
	const groupCount = Math.min(SIM_DEFAULTS.groupCount, agentCount);
	const agentConfigs = generateAgentConfigs(42, agentCount);
	const agentRegistry = spawnAgents(agentConfigs, groupCount);

	// Reset sim state from any previous run
	console.log("Clearing stale sim data...");
	await db.delete(tradesTable);
	await db.delete(ordersTable);
	await db.delete(ticksTable);
	await db.delete(commandsTable);
	await db.delete(simConfigTable);
	await db.delete(agentsTable);

	// Persist bootstrap state to DB so FK constraints are satisfied
	console.log("Persisting bootstrap agents and seed orders to DB...");
	const agentRows = serializeAgentEntriesForDb(agentRegistry.getAll());
	// Insert the seed liquidity provider as a synthetic agent row
	await db
		.insert(agentsTable)
		.values([
			{
				id: "market-maker-seed",
				name: "Seed Liquidity Provider",
				tier: "tier3",
				status: "active",
				entityType: "market-maker",
				strategyType: "depth-provider",
				riskTolerance: 0,
				startingCapital: 0,
				currentCash: 0,
				currentNav: 0,
				positions: {},
				parameters: {},
				llmGroup: 0,
			},
			...agentRows,
		])
		.onConflictDoNothing();

	if (seedOrders.length > 0) {
		await db
			.insert(ordersTable)
			.values(
				seedOrders.map((order) => ({
					id: order.id,
					tick: order.createdAtTick,
					agentId: order.agentId,
					symbol: order.symbol,
					type: order.type,
					side: order.side,
					status: order.status,
					price: order.price.toNumber(),
					quantity: order.qty,
					filledQuantity: order.filledQty,
				})),
			)
			.onConflictDoNothing();
	}
	console.log(`Bootstrapped ${agentRows.length} agents, ${seedOrders.length} seed orders across ${symbols.length} symbols`);

	const eventBus = new EventBus();
	const publicationBus = new PublicationBus();
	const simClock = new SimClock(SIM_DEFAULTS.simulatedTickDuration);

	const orchestrator = new SimOrchestrator(
		matchingEngine,
		agentRegistry,
		simClock,
		publicationBus,
		eventBus,
		db,
		tradingAgent,
	);

	startSimWebSocketServer(3001);

	eventBus.on("ohlcv", (bar) => {
		broadcaster.broadcast(`ohlcv:${bar.symbol}`, bar);
	});

	eventBus.on("lob-update", (snapshot) => {
		broadcaster.broadcast(`lob:${snapshot.symbol}`, snapshot);
	});

	eventBus.on("agent-event", (event) => {
		broadcaster.broadcast("agents", event);
	});

	// The orchestrator.tick() returns a TickSummary, so we can broadcast it right after the await,
	// or via the 'tick' event. The instructions say "Broadcast... tick summary to sim" and
	// "call broadcaster after each tick completes (step 9 of tick lifecycle)".
	// We'll broadcast the summary directly in the loop.

	console.log("Starting simulation orchestrator...");
	await orchestrator.start();

	const minInterval = Number(process.env.SIM_TICK_INTERVAL_MS) || 100;

	console.log("Entering tick loop...");
	while (true) {
		const state = orchestrator.getState();
		if (!state.isRunning) {
			// Process control commands (start/pause/speed) even when paused
			const controlOutcome = await orchestrator.processControlCommands();
			if (controlOutcome.processed) {
				// Broadcast updated state so clients know about play/pause changes
				broadcaster.broadcast("sim", orchestrator.getRuntimeState());
				if (orchestrator.getState().isRunning) continue; // resumed — jump to tick loop
			}

			if (controlOutcome.stepCount > 0) {
				for (let i = 0; i < controlOutcome.stepCount; i += 1) {
					try {
						await orchestrator.tick({ skipPendingCommands: true });
						broadcaster.broadcast("sim", orchestrator.getRuntimeState());
					} catch (error) {
						console.error("Error during step:", error);
						break;
					}
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
			continue;
		}

		const tickStart = Date.now();
		try {
			await orchestrator.tick();
			broadcaster.broadcast("sim", orchestrator.getRuntimeState());
		} catch (error) {
			console.error("Error during tick:", error);
		}

		// Pacing: subtract tick duration so fast ticks get a delay, slow ticks get none
		const elapsed = Date.now() - tickStart;
		const delay = Math.max(0, minInterval - elapsed);
		if (delay > 0) {
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
