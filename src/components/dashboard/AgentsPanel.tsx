import { Badge } from "#/components/ui/badge";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Separator } from "#/components/ui/separator";
import { useAgentMonitor } from "#/hooks/useAgentMonitor";

function formatSide(side: "buy" | "sell") {
	return side.toUpperCase();
}

function AgentStatusBadge({
	isRunning,
	hasFailure,
}: {
	isRunning: boolean;
	hasFailure: boolean;
}) {
	if (isRunning) {
		return (
			<Badge className="border-transparent bg-primary/15 text-primary">
				Running
			</Badge>
		);
	}

	if (hasFailure) {
		return (
			<Badge className="border-transparent bg-destructive/15 text-destructive">
				Failed
			</Badge>
		);
	}

	return <Badge variant="secondary">Idle</Badge>;
}

export function AgentsPanel() {
	const {
		agentIds,
		isConnected,
		liveStateByAgent,
		selectedAgentId,
		selectedLiveState,
		setSelectedAgentId,
	} = useAgentMonitor();

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)]">
			<div className="flex items-center justify-between border-b border-[var(--terminal-border)] px-4 py-3">
				<div>
					<div className="text-sm font-semibold text-[var(--terminal-text)]">
						Agent Inspector
					</div>
					<div className="text-[11px] text-[var(--terminal-text-muted)]">
						Roster and live reasoning
					</div>
				</div>
				<Badge variant={isConnected ? "secondary" : "outline"}>
					{isConnected ? "Connected" : "Reconnecting"}
				</Badge>
			</div>

			<div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)]">
				<div className="min-h-0 border-r border-[var(--terminal-border)]">
					<ScrollArea className="h-full">
						<div className="space-y-1 p-3">
							{agentIds.length === 0 ? (
								<div className="rounded-lg border border-dashed border-[var(--terminal-border)] px-3 py-4 text-sm text-[var(--terminal-text-muted)]">
									Waiting for agent activity...
								</div>
							) : (
								agentIds.map((agentId) => {
									const liveState = liveStateByAgent[agentId];
									const isSelected = agentId === selectedAgentId;
									const latestTick = liveState.events.at(-1)?.tick;

									return (
										<button
											key={agentId}
											type="button"
											onClick={() => setSelectedAgentId(agentId)}
											className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${
												isSelected
													? "border-primary/40 bg-primary/10"
													: "border-[var(--terminal-border)] bg-[var(--terminal-bg)] hover:bg-white/5"
											}`}
										>
											<div className="flex items-start justify-between gap-2">
												<div className="min-w-0">
													<div className="truncate text-sm font-semibold text-[var(--terminal-text)]">
														{liveState.events.at(-1)?.agentName ?? agentId}
													</div>
													<div className="truncate text-[11px] text-[var(--terminal-text-muted)]">
														{agentId}
													</div>
												</div>
												<AgentStatusBadge
													isRunning={liveState.isRunning}
													hasFailure={liveState.latestFailure !== null}
												/>
											</div>
											<div className="mt-3 text-[11px] text-[var(--terminal-text-muted)]">
												{latestTick === undefined ? "No tick yet" : `Last tick ${latestTick}`}
											</div>
										</button>
									);
								})
							)}
						</div>
					</ScrollArea>
				</div>

				<div className="min-h-0">
					<ScrollArea className="h-full">
						<div className="space-y-4 p-4">
							{!selectedAgentId || !selectedLiveState ? (
								<div className="rounded-lg border border-dashed border-[var(--terminal-border)] px-4 py-6 text-sm text-[var(--terminal-text-muted)]">
									Select an agent to inspect its latest reasoning and actions.
								</div>
							) : (
								<>
									<div className="flex items-start justify-between gap-3">
										<div>
											<div className="text-base font-semibold text-[var(--terminal-text)]">
												{selectedLiveState.events.at(-1)?.agentName ?? selectedAgentId}
											</div>
											<div className="text-xs text-[var(--terminal-text-muted)]">
												{selectedAgentId}
											</div>
										</div>
										<AgentStatusBadge
											isRunning={selectedLiveState.isRunning}
											hasFailure={selectedLiveState.latestFailure !== null}
										/>
									</div>

									<div className="grid gap-3 md:grid-cols-2">
										<div className="rounded-lg border border-[var(--terminal-border)] bg-[var(--terminal-bg)] p-3">
											<div className="text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
												Latest Signal
											</div>
											{selectedLiveState.latestSignal ? (
												<div className="mt-3 space-y-2 text-sm text-[var(--terminal-text)]">
													<div className="flex items-center gap-2">
														<Badge
															className={
																selectedLiveState.latestSignal.side === "buy"
																	? "border-transparent bg-emerald-500/15 text-emerald-300"
																	: "border-transparent bg-red-500/15 text-red-300"
															}
														>
															{formatSide(selectedLiveState.latestSignal.side)}
														</Badge>
														<span>{selectedLiveState.latestSignal.symbol}</span>
														<span className="text-[var(--terminal-text-muted)]">
															Qty {selectedLiveState.latestSignal.qty}
														</span>
													</div>
													<div className="text-xs text-[var(--terminal-text-muted)]">
														Price{" "}
														{selectedLiveState.latestSignal.price === 0
															? "MKT"
															: selectedLiveState.latestSignal.price.toFixed(2)}
													</div>
												</div>
											) : (
												<div className="mt-3 text-sm text-[var(--terminal-text-muted)]">
													No signal yet.
												</div>
											)}
										</div>

										<div className="rounded-lg border border-[var(--terminal-border)] bg-[var(--terminal-bg)] p-3">
											<div className="text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
												Latest Failure
											</div>
											{selectedLiveState.latestFailure ? (
												<div className="mt-3 space-y-2">
													<Badge className="border-transparent bg-destructive/15 text-destructive">
														{selectedLiveState.latestFailure.reason}
													</Badge>
													<p className="text-sm text-[var(--terminal-text)]">
														{selectedLiveState.latestFailure.message}
													</p>
												</div>
											) : (
												<div className="mt-3 text-sm text-[var(--terminal-text-muted)]">
													No failures recorded.
												</div>
											)}
										</div>
									</div>

									<Separator className="bg-[var(--terminal-border)]" />

									<div className="space-y-3">
										<div>
											<div className="text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
												Current Thinking
											</div>
											<div className="mt-2 rounded-lg border border-[var(--terminal-border)] bg-[var(--terminal-bg)] p-3">
												<p className="whitespace-pre-wrap text-sm leading-6 text-[var(--terminal-text)]">
													{selectedLiveState.currentTranscript || "No transcript yet."}
												</p>
											</div>
										</div>

										<div>
											<div className="text-[11px] uppercase tracking-[0.12em] text-[var(--terminal-text-muted)]">
												Latest Decision
											</div>
											<div className="mt-2 rounded-lg border border-[var(--terminal-border)] bg-[var(--terminal-bg)] p-3">
												{selectedLiveState.latestDecision ? (
													<div className="space-y-3">
														<p className="whitespace-pre-wrap text-sm leading-6 text-[var(--terminal-text)]">
															{selectedLiveState.latestDecision.reasoning}
														</p>
														<div className="space-y-2">
															{selectedLiveState.latestDecision.ordersPlaced.length === 0 ? (
																<div className="text-sm text-[var(--terminal-text-muted)]">
																	No orders placed.
																</div>
															) : (
																selectedLiveState.latestDecision.ordersPlaced.map((order) => (
																	<div
																		key={order.orderId}
																		className="rounded-md border border-[var(--terminal-border)] px-3 py-2 text-sm text-[var(--terminal-text)]"
																	>
																		<div className="flex items-center gap-2">
																			<Badge
																				className={
																					order.side === "buy"
																						? "border-transparent bg-emerald-500/15 text-emerald-300"
																						: "border-transparent bg-red-500/15 text-red-300"
																				}
																			>
																				{formatSide(order.side)}
																			</Badge>
																			<span>{order.symbol}</span>
																			<span className="text-[var(--terminal-text-muted)]">
																				{order.type === "market" ? "MKT" : order.price}
																			</span>
																			<span className="text-[var(--terminal-text-muted)]">
																				Qty {order.qty}
																			</span>
																			<span className="text-[var(--terminal-text-muted)]">
																				{order.status}
																			</span>
																		</div>
																		{order.rejectionReason ? (
																			<p className="mt-2 text-xs text-destructive">
																				{order.rejectionReason}
																			</p>
																		) : null}
																	</div>
																))
															)}
														</div>
													</div>
												) : (
													<div className="text-sm text-[var(--terminal-text-muted)]">
														No decision yet.
													</div>
												)}
											</div>
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
