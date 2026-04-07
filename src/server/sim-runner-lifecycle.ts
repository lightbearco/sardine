import {
	broadcastSessionStatus,
	clearRuntimeBroadcasts,
} from "./sim-runner-broadcasts";
import type { SimulationRuntime } from "./sim-runner-runtime";

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRuntimeToSettle(
	runtime: SimulationRuntime,
): Promise<void> {
	while (runtime.orchestrator.getState().isTicking) {
		await sleep(25);
	}
}

export async function disposeRuntime(
	runtime: SimulationRuntime,
	options?: { reason?: "completed" | "suspended" },
): Promise<void> {
	if (runtime.disposePromise) {
		await runtime.disposePromise;
		return;
	}

	const isSuspended = options?.reason === "suspended";

	runtime.disposePromise = (async () => {
		await waitForRuntimeToSettle(runtime);
		await runtime.orchestrator.stop();
		broadcastSessionStatus(
			runtime.sessionId,
			isSuspended ? "suspended" : "completed",
		);
		await waitForRuntimeToSettle(runtime);
		runtime.eventBus.removeAllListeners();
		runtime.publicationBus.clear();
		clearRuntimeBroadcasts(runtime.sessionId, {
			clearSession: !isSuspended,
		});
	})();

	try {
		await runtime.disposePromise;
	} finally {
		runtime.disposePromise = null;
	}
}
