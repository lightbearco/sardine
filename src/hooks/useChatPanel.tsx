import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { useSessionDashboard } from "#/hooks/useSessionDashboard";

export type ChatMessage = {
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

interface ChatPanelContextValue {
	isOpen: boolean;
	toggle: () => void;
	open: () => void;
	close: () => void;
	messages: ChatMessage[];
	input: string;
	setInput: (value: string) => void;
	isStreaming: boolean;
	sendMessage: (value?: string) => Promise<void>;
	stopStreaming: () => void;
}

const ChatPanelContext = createContext<ChatPanelContextValue | null>(null);

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

export function ChatPanelProvider({ children }: { children: ReactNode }) {
	const { sessionId } = useSessionDashboard();
	const [isOpen, setIsOpen] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [isStreaming, setIsStreaming] = useState(false);
	const messagesRef = useRef<ChatMessage[]>([]);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	const toggle = useCallback(() => setIsOpen((v) => !v), []);
	const open = useCallback(() => setIsOpen(true), []);
	const close = useCallback(() => setIsOpen(false), []);

	const stopStreaming = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	const sendMessage = useCallback(
		async (value?: string) => {
			const text = (value ?? input).trim();
			if (!text || isStreaming) return;

			const userMsg: ChatMessage = {
				id: nextId(),
				role: "user",
				content: text,
				timestamp: Date.now(),
			};
			const assistantId = nextId();
			const nextMessages = [
				...messagesRef.current,
				userMsg,
				{
					id: assistantId,
					role: "assistant" as const,
					content: "",
					timestamp: Date.now(),
				},
			];
			setMessages(nextMessages);
			setInput("");
			setIsStreaming(true);

			const controller = new AbortController();
			abortRef.current = controller;

			try {
				const allMessages = nextMessages
					.filter((message) => message.role === "user" || message.role === "assistant")
					.filter(
						(message) =>
							message.role !== "assistant" || message.id !== assistantId,
					)
					.map((message) => ({
						role: message.role,
						content: message.content,
					}));

				const res = await fetch("/api/chat", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ messages: allMessages, sessionId }),
					signal: controller.signal,
				});

				if (!res.ok || !res.body) {
					const errText = await res.text();
					setMessages((previous) =>
						previous.map((message) =>
							message.id === assistantId
								? {
										...message,
										content: `Error: ${errText || "Request failed"}`,
									}
								: message,
						),
					);
					setIsStreaming(false);
					return;
				}

				const reader = res.body.getReader();
				const decoder = new TextDecoder();
				let accumulated = "";

				while (true) {
					const { done, value: chunkValue } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(chunkValue, { stream: true });
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
							// Skip malformed SSE lines.
						}
					}

					const eventData = extractEventData(accumulated);
					setMessages((previous) =>
						previous.map((message) =>
							message.id === assistantId
								? { ...message, content: accumulated, eventData }
								: message,
						),
					);
				}
			} catch (error) {
				if ((error as Error).name !== "AbortError") {
					setMessages((previous) =>
						previous.map((message) =>
							message.id === assistantId
								? { ...message, content: "Connection lost. Try again." }
								: message,
						),
					);
				}
			} finally {
				setIsStreaming(false);
				abortRef.current = null;
			}
		},
		[input, isStreaming, sessionId],
	);

	const value = useMemo<ChatPanelContextValue>(
		() => ({
			isOpen,
			toggle,
			open,
			close,
			messages,
			input,
			setInput,
			isStreaming,
			sendMessage,
			stopStreaming,
		}),
		[
			close,
			input,
			isOpen,
			isStreaming,
			messages,
			open,
			sendMessage,
			stopStreaming,
			toggle,
		],
	);

	return (
		<ChatPanelContext.Provider value={value}>
			{children}
		</ChatPanelContext.Provider>
	);
}

export function useChatPanel() {
	const ctx = useContext(ChatPanelContext);
	if (!ctx) {
		throw new Error("useChatPanel must be used within ChatPanelProvider");
	}
	return ctx;
}
