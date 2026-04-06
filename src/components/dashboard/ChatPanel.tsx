import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type FormEvent,
	type KeyboardEvent,
} from "react";
import { Badge } from "#/components/ui/badge";
import { ScrollArea } from "#/components/ui/scroll-area";
import { useSessionDashboard } from "#/hooks/useSessionDashboard";

type ChatMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp: number;
	eventData?: {
		eventId: string;
		type: string;
		title: string;
		magnitude: number;
		affectedSymbols: string[];
		status: string;
	};
};

function extractEventData(text: string): ChatMessage["eventData"] | undefined {
	const idMatch = text.match(/eventId[:\s]+"?([^"\s,]+)/);
	const typeMatch = text.match(
		/type[:\s]+(rate_decision|earnings|news|lawsuit|regulatory|macro|geopolitical|sector_rotation|custom)/,
	);
	const titleMatch = text.match(/(?:title|event)["""][:\s]+([^"',.\n]+)/);
	const magMatch = text.match(/magnitude[:\s]+(-?\d+\.?\d*)/);
	const symbolsMatch = text.match(
		/affected(?:Symbols|symbols)[:\s]+\[([^\]]+)\]/,
	);
	const statusMatch = text.match(
		/status[:\s]+(pending|queued|applied|rejected)/,
	);

	if (!idMatch) return undefined;

	return {
		eventId: idMatch[1],
		type: typeMatch?.[1] ?? "custom",
		title: titleMatch?.[1]?.trim() ?? "Unknown event",
		magnitude: magMatch ? Number.parseFloat(magMatch[1]) : 0,
		affectedSymbols: symbolsMatch
			? symbolsMatch[1].split(",").map((s) => s.trim().replace(/["']/g, ""))
			: [],
		status: statusMatch?.[1] ?? "pending",
	};
}

let msgCounter = 0;
function nextId() {
	return `msg-${++msgCounter}-${Date.now()}`;
}

export function ChatPanel() {
	const { sessionId } = useSessionDashboard();
	const [isOpen, setIsOpen] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const abortRef = useRef<AbortController | null>(null);

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
	}, [scrollToBottom]);

	const handleSubmit = useCallback(
		async (e?: FormEvent) => {
			e?.preventDefault();
			const text = input.trim();
			if (!text || isStreaming) return;

			const userMsg: ChatMessage = {
				id: nextId(),
				role: "user",
				content: text,
				timestamp: Date.now(),
			};
			setMessages((prev) => [...prev, userMsg]);
			setInput("");
			setIsStreaming(true);

			const assistantId = nextId();
			setMessages((prev) => [
				...prev,
				{
					id: assistantId,
					role: "assistant",
					content: "",
					timestamp: Date.now(),
				},
			]);

			const controller = new AbortController();
			abortRef.current = controller;

			try {
				const allMessages = [...messages, userMsg]
					.filter((m) => m.role === "user" || m.role === "assistant")
					.map((m) => ({ role: m.role, content: m.content }));

				const res = await fetch("/api/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ messages: allMessages, sessionId }),
					signal: controller.signal,
				});

				if (!res.ok || !res.body) {
					const errText = await res.text();
					setMessages((prev) =>
						prev.map((m) =>
							m.id === assistantId
								? { ...m, content: `Error: ${errText || "Request failed"}` }
								: m,
						),
					);
					setIsStreaming(false);
					return;
				}

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let accumulated = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value, { stream: true });
					const lines = chunk.split("\n");

					for (const line of lines) {
						if (!line.startsWith("data: ")) continue;
						try {
							const data = JSON.parse(line.slice(6));
							if (data.done) continue;
							if (data.error) {
								accumulated += `\n\nError: ${data.error}`;
								break;
							}
							if (data.text) {
								accumulated += data.text;
							}
						} catch {
							// skip malformed SSE lines
						}
					}

					const eventData = extractEventData(accumulated);
					setMessages((prev) =>
						prev.map((m) =>
							m.id === assistantId
								? { ...m, content: accumulated, eventData }
								: m,
						),
					);
				}
			} catch (err) {
				if ((err as Error).name !== "AbortError") {
					setMessages((prev) =>
						prev.map((m) =>
							m.id === assistantId
								? { ...m, content: "Connection lost. Try again." }
								: m,
						),
					);
				}
			} finally {
				setIsStreaming(false);
				abortRef.current = null;
			}
		},
		[input, isStreaming, messages, sessionId],
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

	const togglePanel = useCallback(() => {
		setIsOpen((prev) => !prev);
	}, []);

	return (
		<>
			<button
				type="button"
				onClick={togglePanel}
				className="fixed right-4 bottom-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-[var(--terminal-border)] bg-[var(--terminal-surface)] text-[var(--terminal-text)] shadow-lg transition-colors hover:bg-[var(--terminal-bg)]"
				aria-label={isOpen ? "Close chat" : "Open chat"}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						togglePanel();
					}
				}}
			>
				<svg
					role="img"
					aria-label={isOpen ? "Close chat" : "Open chat"}
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{isOpen ? (
						<>
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</>
					) : (
						<>
							<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
						</>
					)}
				</svg>
			</button>

			{isOpen && (
				<div className="fixed right-4 bottom-16 z-40 flex h-[520px] w-[400px] flex-col rounded-xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] shadow-2xl">
					<div className="flex items-center justify-between border-b border-[var(--terminal-border)] px-3 py-2">
						<div>
							<div className="text-xs font-semibold text-[var(--terminal-text)]">
								What-If Terminal
							</div>
							<div className="text-[10px] text-[var(--terminal-text-muted)]">
								Describe a scenario, watch agents react
							</div>
						</div>
						<Badge className="border-[var(--terminal-border)] bg-[var(--terminal-bg)] text-[10px] text-[var(--terminal-text-muted)]">
							{isStreaming ? "Thinking..." : "Ready"}
						</Badge>
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
			)}
		</>
	);
}
