import { AgentRegistry } from "#/agents/AgentRegistry";
import { db } from "#/db/index";
import { EventBus } from "#/engine/bus/EventBus";
import { PublicationBus } from "#/engine/bus/PublicationBus";
import { MatchingEngine } from "#/engine/lob/MatchingEngine";
import { SimClock } from "#/engine/sim/SimClock";
import { SimOrchestrator } from "#/engine/sim/SimOrchestrator";
import { tradingAgent } from "#/mastra/agents/trading-agent";
import { broadcaster } from "./ws/broadcaster";
import { startSimWebSocketServer } from "./ws/SimWebSocketServer";

async function main() {
	const agentRegistry = new AgentRegistry();
	const eventBus = new EventBus();
	const publicationBus = new PublicationBus();
	const matchingEngine = new MatchingEngine();
	const simClock = new SimClock(5);

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

	eventBus.on("agent-signal", (signal) => {
		broadcaster.broadcast("agents", signal);
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
			const processed = await orchestrator.processControlCommands();
			if (processed) {
				// Broadcast updated state so clients know about play/pause changes
				const newState = orchestrator.getState();
				broadcaster.broadcast("sim", {
					durationMs: 0,
					orderCount: 0,
					tradeCount: 0,
					activeAgents: 0,
					simTick: newState.simTick,
					simulatedTime: newState.simulatedTime,
					trades: [],
					isRunning: newState.isRunning,
				});
				if (newState.isRunning) continue; // resumed — jump to tick loop
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
			continue;
		}

		const tickStart = Date.now();
		try {
			const summary = await orchestrator.tick();
			broadcaster.broadcast("sim", summary);
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
