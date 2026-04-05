import { Link } from "@tanstack/react-router";

export default function Header() {
	return (
		<header className="sticky top-0 z-40 border-b bg-transparent backdrop-blur-2xl text-foreground backdrop-blur-lg">
			<nav className="page-wrap flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-4 sm:py-4">
				<div className="min-w-0 flex-1 sm:flex-none">
					<Link to="/" className="flex items-center">
						<img
							src="/sardine-logo-white.png"
							alt="Sardine"
							className="size-10 rounded-lg"
						/>
						<span className="truncate font-semibold tracking-tighter text-xl text-white">
							Sardine
						</span>
					</Link>
				</div>

				<div className="order-3 flex w-full flex-wrap items-center gap-x-2 gap-y-1 pb-1 text-sm font-semibold sm:order-2 sm:w-auto sm:flex-nowrap sm:pb-0">
					<Link
						to="/"
						className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
						activeProps={{
							className:
								"inline-flex h-9 items-center rounded-md bg-secondary px-3 text-sm text-secondary-foreground",
						}}
					>
						Home
					</Link>
					<Link
						to="/dashboard"
						className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
						activeProps={{
							className:
								"inline-flex h-9 items-center rounded-md bg-secondary px-3 text-sm text-secondary-foreground",
						}}
					>
						Dashboard
					</Link>
				</div>
			</nav>
		</header>
	);
}
