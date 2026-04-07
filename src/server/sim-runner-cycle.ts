import { createLogger } from "#/lib/logger";
import {
	broadcastSimRuntimeState,
	logRuntimeEvent,
	logTickSummary,
} from "./sim-runner-broadcasts";
import { runResearchCycle } from "./sim-runner-research";
import type { SimulationRuntime } from "./sim-runner-runtime";

const log = createLogger("SimRunner");

function runResearchCycleNonBlocking(
	runtime: SimulationRuntime,
	simTick: number,
): void {
	if (runtime.researchInProgress) {
		log.info(
			{ sessionId: runtime.sessionId, simTick },
			"research cycle skipped (previous cycle still running)",
		);
		return;
	}

	runtime.researchInProgress = true;
	const {
		researchWorkers,
		publicationBus,
		eventBus,
		sessionId,
		researchFrequency,
	} = runtime;

	runResearchCycle(
		researchWorkers,
		simTick,
		publicationBus,
		eventBus,
		sessionId,
		undefined,
		researchFrequency,
	)
		.then(() => {
			log.info({ sessionId, simTick }, "research cycle completed");
		})
		.catch((error: unknown) => {
			log.error({ err: error, sessionId, simTick }, "research cycle failed");
		})
		.finally(() => {
			runtime.researchInProgress = false;
		});
}

export async function processRuntimeCycle(
	runtime: SimulationRuntime,
	envIntervalOverride: number | null,
): Promise<void> {
	if (runtime.disposePromise) {
		return;
	}

	const { orchestrator, sessionId } = runtime;
	const state = orchestrator.getState();

	if (!state.isRunning) {
		const controlOutcome = await orchestrator.processControlCommands();
		for (const message of orchestrator.consumeRuntimeLogMessages()) {
			logRuntimeEvent(sessionId, message);
		}

		if (controlOutcome.processed) {
			broadcastSimRuntimeState(sessionId, orchestrator.getRuntimeState());
			if (orchestrator.getState().isRunning) {
				runtime.nextTickAtMs = Date.now();
				return;
			}
		}

		if (controlOutcome.stepCount > 0) {
			for (let index = 0; index < controlOutcome.stepCount; index += 1) {
				try {
					const summary = await orchestrator.tick({
						skipPendingCommands: true,
					});
					for (const message of orchestrator.consumeRuntimeLogMessages()) {
						logRuntimeEvent(sessionId, message);
					}
					broadcastSimRuntimeState(sessionId, orchestrator.getRuntimeState());
					runResearchCycleNonBlocking(
						runtime,
						orchestrator.getRuntimeState().simTick,
					);
					logTickSummary(sessionId, summary);
				} catch (error) {
					log.error({ err: error, sessionId }, "error during step");
					break;
				}
			}
		}

		return;
	}

	if (Date.now() < runtime.nextTickAtMs) {
		return;
	}

	const tickStartedAt = Date.now();

	try {
		const summary = await orchestrator.tick();
		for (const message of orchestrator.consumeRuntimeLogMessages()) {
			logRuntimeEvent(sessionId, message);
		}
		broadcastSimRuntimeState(sessionId, orchestrator.getRuntimeState());
		runResearchCycleNonBlocking(
			runtime,
			orchestrator.getRuntimeState().simTick,
		);
		logTickSummary(sessionId, summary);
	} catch (error) {
		log.error({ err: error, sessionId }, "error during tick");
	}

	const elapsed = Date.now() - tickStartedAt;
	const runtimeState = orchestrator.getRuntimeState();
	const baseInterval = envIntervalOverride ?? runtimeState.tickIntervalMs;
	const speedMultiplier = Math.max(runtimeState.speedMultiplier, 0.001);
	const configuredInterval = baseInterval / speedMultiplier;
	const delay = Math.max(0, configuredInterval - elapsed);
	runtime.nextTickAtMs = Date.now() + delay;
}
