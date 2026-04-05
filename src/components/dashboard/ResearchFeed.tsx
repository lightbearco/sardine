import { useState } from "react";
import { Badge } from "#/components/ui/badge";
import { ScrollArea } from "#/components/ui/scroll-area";
import { useResearchFeed } from "#/hooks/useResearchFeed";
import type { ResearchNote } from "#/types/research";

const SENTIMENT_CLASS: Record<ResearchNote["sentiment"], string> = {
	bullish: "border-transparent bg-emerald-500/15 text-emerald-300",
	bearish: "border-transparent bg-red-500/15 text-red-300",
	neutral: "border-(--terminal-border) bg-(--terminal-bg) text-(--terminal-text-muted)",
};

const FOCUS_CLASS: Record<string, string> = {
	news: "bg-blue-500/10 text-blue-300 border-transparent",
	macro: "bg-purple-500/10 text-purple-300 border-transparent",
	sentiment: "bg-amber-500/10 text-amber-300 border-transparent",
	filings: "bg-cyan-500/10 text-cyan-300 border-transparent",
};

function formatSources(sources: string[]): string {
	return sources
		.map((s) => { try { return new URL(s).hostname.replace(/^www\./, ""); } catch { return s; } })
		.join(", ");
}

export function ResearchFeed() {
	const { notes, isConnected } = useResearchFeed(24);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

	function toggleNote(id: string) {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	return (
		<section className="flex h-full min-h-0 flex-col rounded-xl border border-(--terminal-border) bg-(--terminal-surface) overflow-hidden">
			<div className="flex items-center justify-between border-b border-(--terminal-border) px-3 py-2 shrink-0">
				<span className="text-xs font-semibold text-(--terminal-text)">Research Feed</span>
				<div className="flex items-center gap-2">
					<span className="text-[10px] text-(--terminal-text-muted)">{notes.length} notes</span>
					<Badge className={`text-[10px] px-1.5 py-0 ${isConnected ? "border-transparent bg-primary/15 text-primary-foreground" : "border-(--terminal-border) bg-(--terminal-bg) text-(--terminal-text-muted)"}`}>
						{isConnected ? "Live" : "Syncing"}
					</Badge>
				</div>
			</div>

			<ScrollArea className="min-h-0 flex-1">
				<div className="space-y-2 p-2">
					{notes.length === 0 ? (
						<div className="rounded-lg border border-dashed border-(--terminal-border) px-4 py-6 text-xs text-(--terminal-text-muted)">
							Waiting for published research notes…
						</div>
					) : (
						notes.map((note) => {
							const isExpanded = expandedIds.has(note.id);
							return (
								<article key={note.id} className="rounded-lg border border-(--terminal-border) bg-(--terminal-bg)">
									{/* Header row — always visible, click to toggle */}
									<button
										type="button"
										onClick={() => toggleNote(note.id)}
										className="w-full p-2.5 text-left"
									>
										<div className="flex items-start justify-between gap-2">
											<span className="text-xs font-semibold leading-4 text-(--terminal-text)">{note.headline}</span>
											<div className="flex items-center gap-1.5 shrink-0">
												<Badge className={`${SENTIMENT_CLASS[note.sentiment]} text-[10px] px-1.5 py-0`}>
													{note.sentiment}
												</Badge>
												<span className="text-[10px] text-(--terminal-text-muted)">{isExpanded ? "▲" : "▼"}</span>
											</div>
										</div>

										{/* Meta chips — always visible */}
										<div className="mt-1.5 flex flex-wrap items-center gap-1">
											<Badge className={`${FOCUS_CLASS[note.focus] ?? "border-(--terminal-border) bg-(--terminal-surface) text-(--terminal-text-muted)"} text-[10px] px-1.5 py-0`}>
												{note.focus}
											</Badge>
											<Badge className="border-(--terminal-border) bg-(--terminal-surface) text-(--terminal-text) text-[10px] px-1.5 py-0">
												{Math.round(note.confidence * 100)}% conf
											</Badge>
											<Badge className="border-(--terminal-border) bg-(--terminal-surface) text-(--terminal-text-muted) text-[10px] px-1.5 py-0">
												t{note.publishedAtTick}
											</Badge>
											{note.symbols.map((symbol) => (
												<Badge key={`${note.id}-${symbol}`} className="border-(--terminal-border) bg-(--terminal-surface) text-(--terminal-text) text-[10px] px-1.5 py-0">
													{symbol}
												</Badge>
											))}
											{note.sources.length > 0 && (
												<span className="text-[10px] text-(--terminal-text-muted) truncate">
													{formatSources(note.sources)}
												</span>
											)}
										</div>
									</button>

									{/* Expandable body */}
									{isExpanded && (
										<div className="border-t border-(--terminal-border) px-2.5 py-2">
											<p className="text-[11px] leading-[1.6] text-(--terminal-text-muted) whitespace-pre-wrap">
												{note.body}
											</p>
										</div>
									)}
								</article>
							);
						})
					)}
				</div>
			</ScrollArea>
		</section>
	);
}
