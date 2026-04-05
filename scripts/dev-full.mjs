import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const processes = [
	{
		name: "app",
		child: spawn(npmCommand, ["run", "dev"], {
			stdio: "inherit",
			env: process.env,
		}),
	},
	{
		name: "sim",
		child: spawn(npmCommand, ["run", "sim"], {
			stdio: "inherit",
			env: process.env,
		}),
	},
];

function shutdown(exitCode = 0) {
	for (const { child } of processes) {
		if (!child.killed) {
			child.kill("SIGTERM");
		}
	}

	process.exit(exitCode);
}

for (const { name, child } of processes) {
	child.on("exit", (code, signal) => {
		if (signal) {
			console.log(`[dev:full] ${name} exited with signal ${signal}`);
			shutdown(1);
			return;
		}

		if ((code ?? 0) !== 0) {
			console.error(`[dev:full] ${name} exited with code ${code}`);
			shutdown(code ?? 1);
		}
	});
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
