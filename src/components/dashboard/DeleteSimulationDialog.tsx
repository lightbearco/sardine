import { Button } from "#/components/ui/button";

export function DeleteSimulationDialog({
	sessionName,
	isDeleting,
	onCancel,
	onConfirm,
}: {
	sessionName: string;
	isDeleting: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-simulation-title"
			onClick={() => {
				if (!isDeleting) {
					onCancel();
				}
			}}
		>
			<div
				className="w-full max-w-lg rounded-3xl border border-[var(--terminal-border)] bg-[var(--terminal-surface)] p-6 shadow-2xl"
				onClick={(event) => event.stopPropagation()}
			>
				<div>
					<div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--terminal-text-muted)]">
						Delete Session
					</div>
					<h2
						id="delete-simulation-title"
						className="mt-2 text-2xl font-semibold text-[var(--terminal-text)]"
					>
						Delete {sessionName}?
					</h2>
					<p className="mt-3 text-sm leading-6 text-[var(--terminal-text-muted)]">
						This permanently removes the simulation and all of its persisted
						state, market history, research notes, agent events, and runtime
						artifacts. This action cannot be undone.
					</p>
				</div>

				<div className="mt-6 flex items-center justify-end gap-2">
					<Button
						variant="ghost"
						onClick={onCancel}
						disabled={isDeleting}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={onConfirm}
						disabled={isDeleting}
					>
						{isDeleting ? "Deleting..." : "Delete Session"}
					</Button>
				</div>
			</div>
		</div>
	);
}
