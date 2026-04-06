import pino from "pino";

export const logger = pino({
	name: "sardine",
	level: process.env.LOG_LEVEL ?? "info",
	transport: {
		target: "pino-pretty",
		options: {
			colorize: true,
			levelFirst: true,
			translateTime: "SYS:HH:MM:ss.l",
			ignore: "pid,hostname",
			singleLine: false,
		},
	},
});

export function createLogger(module: string) {
	return logger.child({ module });
}

process.on("uncaughtException", (err) => {
	logger.fatal({ err }, "uncaught exception");
	process.exit(1);
});

process.on("unhandledRejection", (err) => {
	logger.fatal({ err }, "unhandled rejection");
	process.exit(1);
});
