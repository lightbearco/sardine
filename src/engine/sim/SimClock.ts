import { SIM_DEFAULTS } from "#/lib/constants";

export class SimClock {
	private _simTick = 0;
	private _simulatedTime: Date;
	private readonly _startTime: Date;
	private readonly tickDuration: number;

	constructor(simulatedTickDuration: number = SIM_DEFAULTS.simulatedTickDuration) {
		this.tickDuration = simulatedTickDuration;
		this._startTime = marketOpen();
		this._simulatedTime = new Date(this._startTime);
	}

	advance(): void {
		this._simTick++;
		this._simulatedTime = new Date(
			this._simulatedTime.getTime() + this.tickDuration * 1000,
		);
	}

	reset(): void {
		this._simTick = 0;
		this._simulatedTime = new Date(this._startTime);
	}

	get simTick(): number {
		return this._simTick;
	}

	get simulatedTime(): Date {
		return this._simulatedTime;
	}
}

/** Returns today at 09:30:00 ET (America/New_York). */
function marketOpen(): Date {
	const now = new Date();
	const dateStr = now.toLocaleDateString("en-CA", {
		timeZone: "America/New_York",
	}); // YYYY-MM-DD

	// Determine the ET offset by comparing a known NY-formatted time to UTC
	const utcMidnight = new Date(`${dateStr}T00:00:00Z`);
	const nyMidnightStr = utcMidnight.toLocaleString("en-US", {
		timeZone: "America/New_York",
		hour12: false,
		hour: "2-digit",
	});
	// If UTC midnight shows as "19" in NY, offset is -5; "20" means -4
	const nyHour = Number.parseInt(nyMidnightStr, 10);
	const offsetHours = nyHour >= 12 ? 24 - nyHour : -nyHour;

	return new Date(`${dateStr}T09:30:00-${String(offsetHours).padStart(2, "0")}:00`);
}
