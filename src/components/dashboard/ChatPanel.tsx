import {
	useCallback,
	useEffect,
	useRef,
	type FormEvent,
	type KeyboardEvent,
} from "react";
import { Badge } from "#/components/ui/badge";
import { ScrollArea } from "#/components/ui/scroll-area";
import { useChatPanel } from "#/hooks/useChatPanel";

export function ChatPanel() {
	const {
		isOpen,
		close,
		messages,
		input,
		setInput,
		isStreaming,
		sendMessage,
	} = useChatPanel();
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	const scrollToBottom = useCallback(() => {
		requestAnimationFrame(() => {
			if (scrollRef.current) {
				const viewport = scrollRef.current.querySelector(
					"[data-slot='scroll-area-viewport']",
				);
				if (viewport) {
					viewport.scrollTop = viewport.scrollHeight;
				}
			}
		});
	}, []);

	useEffect(() => {
		scrollToBottom();
	}, [messages, scrollToBottom]);

	const handleSubmit = useCallback(
		async (e?: FormEvent) => {
			e?.preventDefault();
			await sendMessage();
		},
		[sendMessage],
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				void handleSubmit();
			}
		},
		[handleSubmit],
	);

	if (!isOpen) return null;

	return (
		<div className="fixed right-4 bottom-4 z-40 flex h-[520px] w-[400px] flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] shadow-2xl">
			<div className="flex items-center justify-between border-b border-[var(--terminal-border)] px-3 py-2">
				<div>
					<div className="text-xs font-semibold text-[var(--terminal-text)]">
						What-If Terminal
					</div>
					<div className="text-[10px] text-[var(--terminal-text-muted)]">
						Describe a scenario, watch agents react
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Badge className="border-[var(--terminal-border)] bg-[var(--terminal-bg)] text-[10px] text-[var(--terminal-text-muted)]">
						{isStreaming ? "Thinking..." : "Ready"}
					</Badge>
					<button
						type="button"
						onClick={close}
						className="rounded p-1 text-[var(--terminal-text-muted)] hover:text-[var(--terminal-text)]"
						aria-label="Close chat"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							role="img"
							aria-label="Close"
						>
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</svg>
					</button>
				</div>
			</div>

			<ScrollArea ref={scrollRef} className="min-h-0 flex-1">
				<div className="space-y-3 p-3">
					{messages.length === 0 && (
						<div className="rounded-lg border border-dashed border-[var(--terminal-border)] px-4 py-6 text-center text-xs text-[var(--terminal-text-muted)]">
							<p className="mb-1">
								Describe a market scenario in natural language.
							</p>
							<p className="text-[10px]">
								e.g. "What if the Fed raises rates 50bps?"
							</p>
						</div>
					)}
					{messages.map((msg) => (
						<div
							key={msg.id}
							className={`rounded-lg border px-3 py-2.5 text-xs leading-5 ${
								msg.role === "user"
									? "border-primary/30 bg-primary/5 text-[var(--terminal-text)]"
									: "border-[var(--terminal-border)] bg-[var(--terminal-bg)] text-[var(--terminal-text-muted)]"
							}`}
						>
							{msg.role === "assistant" && msg.content === "" ? (
								<span className="animate-pulse text-[var(--terminal-text-muted)]">
									Thinking...
								</span>
							) : (
								<>
									{msg.eventData && (
										<div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
											<div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-300">
												<Badge className="border-transparent bg-amber-500/15 px-1.5 py-0 text-[10px] text-amber-300">
													EVENT
												</Badge>
												<span>{msg.eventData.title}</span>
											</div>
											<div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
												<Badge className="border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-1.5 py-0 text-[10px] text-[var(--terminal-text)]">
													{msg.eventData.type}
												</Badge>
												<Badge className="border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-1.5 py-0 text-[10px] text-[var(--terminal-text)]">
													mag: {msg.eventData.magnitude.toFixed(2)}
												</Badge>
												<Badge className="border-transparent bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
													{msg.eventData.status}
												</Badge>
												{msg.eventData.affectedSymbols.map((sym) => (
													<Badge
														key={sym}
														className="border-[var(--terminal-border)] bg-[var(--terminal-surface)] px-1.5 py-0 text-[10px] text-[var(--terminal-text)]"
													>
														{sym}
													</Badge>
												))}
											</div>
										</div>
									)}
									<p className="whitespace-pre-wrap">{msg.content}</p>
								</>
							)}
						</div>
					))}
				</div>
			</ScrollArea>

			<form
				onSubmit={handleSubmit}
				className="border-t border-[var(--terminal-border)] p-2"
			>
				<textarea
					ref={inputRef}
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="What if the Fed raises rates 50bps?"
					disabled={isStreaming}
					rows={2}
					className="w-full resize-none rounded-md border border-[var(--terminal-border)] bg-[var(--terminal-bg)] px-3 py-2 text-xs text-[var(--terminal-text)] placeholder:text-[var(--terminal-text-muted)] focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
				/>
				<div className="mt-1.5 flex items-center justify-between">
					<span className="text-[10px] text-[var(--terminal-text-muted)]">
						Enter to send, Shift+Enter for newline
					</span>
					<button
						type="submit"
						disabled={isStreaming || !input.trim()}
						className="rounded-md bg-primary px-3 py-1 text-[10px] font-medium text-primary-foreground disabled:opacity-50"
					>
						Send
					</button>
				</div>
			</form>
		</div>
	);
}
