import EventEmitter from "eventemitter3";
import type { Trade, Order, LOBSnapshot, OHLCVBar } from "#/types/market";
import type { ResearchNote } from "#/types/research";
import type {
	AgentEvent,
	AgentThinkingDelta,
	SimRuntimeState,
	WorldEvent,
} from "#/types/sim";

export interface EventMap {
	trade: [trade: Trade];
	order: [order: Order];
	tick: [tick: { simTick: number; simulatedTime: Date }];
	"lob-update": [snapshot: LOBSnapshot];
	ohlcv: [bar: OHLCVBar];
	"world-event": [event: WorldEvent];
	"agent-event": [event: AgentEvent];
	"agent-thinking": [delta: AgentThinkingDelta];
	"research-published": [note: ResearchNote];
	"sim-state": [state: SimRuntimeState];
	divergence: [data: { symbol: string; divergencePct: number }];
}

export class EventBus {
	private emitter = new EventEmitter<EventMap>();

	emit<K extends EventEmitter.EventNames<EventMap>>(
		event: K,
		...args: EventEmitter.EventArgs<EventMap, K>
	): void {
		this.emitter.emit(event, ...args);
	}

	on<K extends EventEmitter.EventNames<EventMap>>(
		event: K,
		listener: EventEmitter.EventListener<EventMap, K>,
	): void {
		this.emitter.on(event, listener as (...args: unknown[]) => void);
	}

	off<K extends EventEmitter.EventNames<EventMap>>(
		event: K,
		listener: EventEmitter.EventListener<EventMap, K>,
	): void {
		this.emitter.off(event, listener as (...args: unknown[]) => void);
	}

	removeAllListeners<K extends EventEmitter.EventNames<EventMap>>(
		event?: K,
	): void {
		this.emitter.removeAllListeners(event);
	}
}
