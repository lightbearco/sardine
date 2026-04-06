import { Maximize2, Minimize2 } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { useMaximizedPanel } from "#/hooks/useMaximizedPanel";

export function MaximizeButton({ panelId }: { panelId: string }) {
	const { maximizedId, toggleMaximize } = useMaximizedPanel();
	const isMaximized = maximizedId === panelId;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					onClick={() => toggleMaximize(panelId)}
					className="rounded p-0.5 text-[var(--terminal-text-muted)] transition-colors hover:text-[var(--terminal-text)]"
				>
					{isMaximized ? (
						<Minimize2 className="size-3" />
					) : (
						<Maximize2 className="size-3" />
					)}
				</button>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				{isMaximized ? "Restore" : "Maximize"}
			</TooltipContent>
		</Tooltip>
	);
}
