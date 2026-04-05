import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useRef } from "react";
import { Badge } from "#/components/ui/badge";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Separator } from "#/components/ui/separator";
import { useAgentMonitor } from "#/hooks/useAgentMonitor";

function AgentStatusBadge({
	isRunning,
	hasFailure,
}: {
	isRunning: boolean;
	hasFailure: boolean;
}) {
	if (isRunning)
		return (
			<Badge className="border-transparent bg-primary/15 text-primary-foreground text-[10px] px-1.5 py-0">
				Live
			</Badge>
		);
	if (hasFailure)
		return (
			<Badge className="border-transparent bg-destructive/15 text-destructive text-[10px] px-1.5 py-0">
				Failed
			</Badge>
		);
	return (
		<Badge className="border-(--terminal-border) bg-(--terminal-bg) text-(--terminal-text-muted) text-[10px] px-1.5 py-0">
			Idle
		</Badge>
	);
}

function formatSide(side: "buy" | "sell") {
	return side.toUpperCase();
}

const ROW_HEIGHT = 62;

type AgentListItemProps = {
	agentId: string;
	state: ReturnType<typeof useAgentMonitor>["liveStateByAgent"][string];
	isSelected: boolean;
	onSelect: (agentId: string) => void;
};

const AgentListItem = memo(function AgentListItem({
	agentId,
	state,
	isSelected,
	onSelect,
}: AgentListItemProps) {
	const latestTick = state.events.at(-1)?.tick;
	return (
		<button
			type="button"
			onClick={() => onSelect(agentId)}
			className={`w-full rounded-md border px-2.5 py-2 text-left transition-colors ${
				isSelected
					? "border-primary/40 bg-primary/10"
					: "border-(--terminal-border) bg-(--terminal-bg) hover:bg-white/5"
			}`}
		>
			<div className="flex items-center justify-between gap-1">
				<span className="truncate text-xs font-semibold text-(--terminal-text)">
					{state.agentName || agentId}
				</span>
				<AgentStatusBadge
					isRunning={state.isRunning}
					hasFailure={state.latestFailure !== null}
				/>
			</div>
			<div className="mt-0.5 text-[10px] text-(--terminal-text-muted)">
				{latestTick === undefined ? "No tick yet" : `Tick ${latestTick}`}
			</div>
		</button>
	);
});

export function AgentsPanel() {
	const {
		agentIds,
		isConnected,
		isLive,
		liveStateByAgent,
		selectedAgentId,
		selectedLiveState,
		setSelectedAgentId,
	} = useAgentMonitor();
	const listRef = useRef<HTMLDivElement | null>(null);
	const virtualizer = useVirtualizer({
		count: agentIds.length,
		getScrollElement: () => listRef.current,
		estimateSize: () => ROW_HEIGHT,
		overscan: 6,
	});

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-(--terminal-border) bg-(--terminal-surface) overflow-hidden">
			<div className="flex items-center justify-between border-b border-(--terminal-border) px-3 py-2 shrink-0">
				<span className="text-xs font-semibold text-(--terminal-text)">
					Agent Inspector
				</span>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-(--terminal-text-muted)">
						{agentIds.length} agents
					</span>
					<Badge className="border-(--terminal-border) bg-(--terminal-bg) text-(--terminal-text) text-[10px] px-1.5 py-0">
						{!isLive
							? "Historical"
							: isConnected
								? "Connected"
								: "Reconnecting"}
					</Badge>
				</div>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)]">
				<div className="min-h-0 border-r border-(--terminal-border)">
					<div ref={listRef} className="min-h-0 h-full overflow-auto px-2 py-2">
						{agentIds.length === 0 ? (
							<div className="rounded-lg border border-dashed border-(--terminal-border) px-3 py-4 text-xs text-(--terminal-text-muted)">
								{isLive
									? "Waiting for agents…"
									: "No live activity in historical sessions."}
							</div>
						) : (
							<div
								className="relative"
								style={{ height: `${virtualizer.getTotalSize()}px` }}
							>
								{virtualizer.getVirtualItems().map((virtualRow) => {
									const agentId = agentIds[virtualRow.index];
									const state = liveStateByAgent[agentId];
									if (!state) {
										return null;
									}
									return (
										<div
											key={`${agentId}-${virtualRow.index}`}
											className="absolute inset-x-0 top-0"
											style={{
												transform: `translateY(${virtualRow.start}px)`,
												height: `${virtualRow.size}px`,
											}}
										>
											<AgentListItem
												agentId={agentId}
												state={state}
												isSelected={agentId === selectedAgentId}
												onSelect={setSelectedAgentId}
											/>
										</div>
									);
								})}
							</div>
						)}
					</div>
				</div>

				<div className="min-h-0">
					<ScrollArea className="h-full">
						<div className="space-y-3 p-3">
							{!selectedAgentId || !selectedLiveState ? (
								<div className="rounded-lg border border-dashed border-(--terminal-border) px-4 py-6 text-xs text-(--terminal-text-muted)">
									Select an agent to inspect its reasoning and actions.
								</div>
							) : (
								<>
									<div className="flex items-start justify-between gap-2">
										<div>
											<div className="text-sm font-semibold text-(--terminal-text)">
												{selectedLiveState.agentName || selectedAgentId}
											</div>
										</div>
										<AgentStatusBadge
											isRunning={selectedLiveState.isRunning}
											hasFailure={selectedLiveState.latestFailure !== null}
										/>
									</div>

									<div className="grid grid-cols-2 gap-2">
										<div className="rounded-lg border border-(--terminal-border) bg-(--terminal-bg) p-2.5">
											<div className="text-[10px] uppercase tracking-widest text-(--terminal-text-muted)">
												Signal
											</div>
											{selectedLiveState.latestSignal ? (
												<div className="mt-2 space-y-1 text-xs text-(--terminal-text)">
													<div className="flex items-center gap-1.5">
														<Badge
															className={
																selectedLiveState.latestSignal.side === "buy"
																	? "border-transparent bg-emerald-500/15 text-emerald-300 text-[10px] px-1.5 py-0"
																	: "border-transparent bg-red-500/15 text-red-300 text-[10px] px-1.5 py-0"
															}
														>
															{formatSide(selectedLiveState.latestSignal.side)}
														</Badge>
														<span>{selectedLiveState.latestSignal.symbol}</span>
														<span className="text-(--terminal-text-muted)">
															×{selectedLiveState.latestSignal.qty}
														</span>
													</div>
													<div className="text-[10px] text-(--terminal-text-muted)">
														@{" "}
														{selectedLiveState.latestSignal.price === 0
															? "MKT"
															: selectedLiveState.latestSignal.price.toFixed(2)}
													</div>
												</div>
											) : (
												<div className="mt-2 text-xs text-(--terminal-text-muted)">
													No signal yet.
												</div>
											)}
										</div>

										<div className="rounded-lg border border-(--terminal-border) bg-(--terminal-bg) p-2.5">
											<div className="text-[10px] uppercase tracking-widest text-(--terminal-text-muted)">
												Failure
											</div>
											{selectedLiveState.latestFailure ? (
												<div className="mt-2 space-y-1">
													<Badge className="border-transparent bg-destructive/15 text-destructive text-[10px] px-1.5 py-0">
														{selectedLiveState.latestFailure.reason}
													</Badge>
													<p className="text-xs text-(--terminal-text)">
														{selectedLiveState.latestFailure.message}
													</p>
												</div>
											) : (
												<div className="mt-2 text-xs text-(--terminal-text-muted)">
													No failures.
												</div>
											)}
										</div>
									</div>

									<Separator className="bg-(--terminal-border)" />

									<div>
										<div className="mb-1.5 text-[10px] uppercase tracking-widest text-(--terminal-text-muted)">
											Thinking
										</div>
										<div className="rounded-lg border border-(--terminal-border) bg-(--terminal-bg) p-2.5">
											<p className="whitespace-pre-wrap text-xs leading-5 text-(--terminal-text)">
												{selectedLiveState.currentTranscript ||
													"No transcript yet."}
											</p>
										</div>
									</div>

									<div>
										<div className="mb-1.5 text-[10px] uppercase tracking-widest text-(--terminal-text-muted)">
											Last Decision
										</div>
										<div className="rounded-lg border border-(--terminal-border) bg-(--terminal-bg) p-2.5">
											{selectedLiveState.latestDecision ? (
												<div className="space-y-2">
													<p className="whitespace-pre-wrap text-xs leading-5 text-(--terminal-text)">
														{selectedLiveState.latestDecision.reasoning}
													</p>
													{selectedLiveState.latestDecision.ordersPlaced
														.length > 0 && (
														<div className="space-y-1.5 border-t border-(--terminal-border) pt-2">
															{selectedLiveState.latestDecision.ordersPlaced.map(
																(order) => (
																	<div
																		key={order.orderId}
																		className="rounded border border-(--terminal-border) px-2.5 py-1.5 text-xs text-(--terminal-text)"
																	>
																		<div className="flex flex-wrap items-center gap-1.5">
																			<Badge
																				className={
																					order.side === "buy"
																						? "border-transparent bg-emerald-500/15 text-emerald-300 text-[10px] px-1.5 py-0"
																						: "border-transparent bg-red-500/15 text-red-300 text-[10px] px-1.5 py-0"
																				}
																			>
																				{formatSide(order.side)}
																			</Badge>
																			<span>{order.symbol}</span>
																			<span className="text-(--terminal-text-muted)">
																				{order.type === "market"
																					? "MKT"
																					: order.price}
																			</span>
																			<span className="text-(--terminal-text-muted)">
																				×{order.qty}
																			</span>
																			<span className="text-(--terminal-text-muted)">
																				{order.status}
																			</span>
																		</div>
																		{order.rejectionReason && (
																			<p className="mt-1 text-[10px] text-destructive">
																				{order.rejectionReason}
																			</p>
																		)}
																	</div>
																),
															)}
														</div>
													)}
												</div>
											) : (
												<div className="text-xs text-(--terminal-text-muted)">
													No decision yet.
												</div>
											)}
										</div>
									</div>
								</>
							)}
						</div>
					</ScrollArea>
				</div>
			</div>
		</section>
	);
}
