import { useEffect, useRef } from "react";
import { useAgentFeed } from "#/hooks/useAgentFeed";
import { Badge } from "#/components/ui/badge";
import { ScrollArea } from "#/components/ui/scroll-area";

export function SignalFeed() {
	const { events } = useAgentFeed(50);
	const bottomRef = useRef<HTMLDivElement | null>(null);
	const cards = events.filter(
		(event) => event.type === "signal" || event.type === "decision",
	);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ block: "end" });
	}, [cards.length]);

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)]">
			<div className="border-b border-[var(--terminal-border)] px-4 py-3">
				<div className="text-sm font-semibold text-[var(--terminal-text)]">
					Signal Feed
				</div>
				<div className="text-[11px] text-[var(--terminal-text-muted)]">
					Decision stream
				</div>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="space-y-3 p-4">
					{cards
						.slice()
						.reverse()
						.map((event, index) => {
							const isSignal = event.type === "signal";
							const title = isSignal
								? `${event.signal.side.toUpperCase()} ${event.signal.symbol}`
								: "Decision";
							const body = isSignal
								? event.signal.reasoning ?? "No reasoning provided"
								: event.decision.reasoning;
							return (
								<article
									key={event.eventId ?? `${event.agentId}-${event.tick}-${index}`}
									className="rounded-lg border border-[var(--terminal-border)] bg-[var(--terminal-bg)] p-3"
								>
									<div className="flex items-start justify-between gap-3">
										<div>
											<div className="text-sm font-semibold text-[var(--terminal-text)]">
												{event.agentName}
											</div>
											<div className="text-xs text-[var(--terminal-text-muted)]">
												Tick {event.tick}
											</div>
										</div>
										<Badge variant="secondary">{title}</Badge>
									</div>
									<p className="mt-3 text-sm leading-6 text-[var(--terminal-text-muted)]">
										{body}
									</p>
								</article>
							);
						})}
					<div ref={bottomRef} />
				</div>
			</ScrollArea>
		</section>
	);
}
