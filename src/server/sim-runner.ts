import { pathToFileURL } from "node:url";
import { createLogger } from "#/lib/logger";
import {
	hardDeleteSimulationSession,
	listDeletingSimulationSessions,
	listRunnableSimulationSessions,
	markSimulationSessionFailed,
} from "#/server/sessions";
import { processRuntimeCycle } from "./sim-runner-cycle";
import {
	broadcastSessionStatus,
	logRuntimeEvent,
} from "./sim-runner-broadcasts";
import { disposeRuntime, sleep } from "./sim-runner-lifecycle";
export { disposeRuntime } from "./sim-runner-lifecycle";
export {
	runResearchCycle,
	shouldRunResearchCycle,
} from "./sim-runner-research";
import {
	bootstrapSimulationRuntime,
	getMaxLiveSessions,
	resumeSimulationRuntime,
	selectActiveSessionsToResume,
	selectPendingSessionsToBootstrap,
	type SimulationRuntime,
} from "./sim-runner-runtime";
export {
	getMaxLiveSessions,
	selectActiveSessionsToResume,
	selectPendingSessionsToBootstrap,
	splitRunnableSessions,
	type RunnableSimulationSession,
	type SimulationRuntime,
} from "./sim-runner-runtime";
import { startSimWebSocketServer } from "./ws/SimWebSocketServer";

const log = createLogger("SimRunner");

async function main() {
	startSimWebSocketServer(3001);

	const runtimes = new Map<string, SimulationRuntime>();
	const envIntervalOverride = process.env.SIM_TICK_INTERVAL_MS
		? Number(process.env.SIM_TICK_INTERVAL_MS)
		: null;
	const maxLiveSessions = getMaxLiveSessions();

	log.info({ maxLiveSessions }, "worker started");

	while (true) {
		const [runnableSessions, deletingSessions] = await Promise.all([
			listRunnableSimulationSessions(),
			listDeletingSimulationSessions(),
		]);
		const runnableIds = new Set(runnableSessions.map((session) => session.id));
		const deletingIds = new Set(deletingSessions.map((session) => session.id));

		for (const runtimeId of Array.from(runtimes.keys())) {
			if (deletingIds.has(runtimeId)) {
				continue;
			}

			if (!runnableIds.has(runtimeId)) {
				const runtime = runtimes.get(runtimeId);
				if (!runtime) {
					continue;
				}

				await disposeRuntime(runtime, { reason: "suspended" });
				runtimes.delete(runtimeId);
				logRuntimeEvent(runtimeId, "unloaded");
			}
		}

		for (const session of deletingSessions) {
			const runtime = runtimes.get(session.id);

			if (runtime) {
				await disposeRuntime(runtime);
				runtimes.delete(session.id);
				logRuntimeEvent(session.id, "disposed for deletion");
			}

			try {
				await hardDeleteSimulationSession(session.id);
				logRuntimeEvent(session.id, "deleted");
			} catch (error) {
				log.error(
					{ err: error, sessionId: session.id },
					"failed to delete session",
				);
			}
		}

		const activeSessionsToResume = selectActiveSessionsToResume({
			sessions: runnableSessions,
			loadedRuntimeIds: runtimes.keys(),
			maxLiveSessions,
		});

		for (const session of activeSessionsToResume) {
			try {
				const runtime = await resumeSimulationRuntime(session);
				runtimes.set(session.id, runtime);
			} catch (error) {
				log.error(
					{ err: error, sessionId: session.id },
					"failed to resume session",
				);
				broadcastSessionStatus(session.id, "failed");
				await markSimulationSessionFailed(session.id);
			}
		}

		const pendingSessionsToBootstrap = selectPendingSessionsToBootstrap({
			sessions: runnableSessions,
			loadedRuntimeIds: runtimes.keys(),
			maxLiveSessions,
		});

		for (const session of pendingSessionsToBootstrap) {
			try {
				const runtime = await bootstrapSimulationRuntime(session);
				runtimes.set(session.id, runtime);
			} catch (error) {
				log.error(
					{ err: error, sessionId: session.id },
					"failed to bootstrap session",
				);
				broadcastSessionStatus(session.id, "failed");
				await markSimulationSessionFailed(session.id);
			}
		}

		if (runtimes.size === 0) {
			await sleep(250);
			continue;
		}

		for (const runtime of runtimes.values()) {
			await processRuntimeCycle(runtime, envIntervalOverride);
		}

		await sleep(100);
	}
}

const isMainModule =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
	main().catch((error) => {
		log.fatal({ err: error }, "fatal error");
		process.exit(1);
	});
}
