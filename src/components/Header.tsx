import { Link } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'
import { Button } from './ui/button'

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 px-4 text-foreground backdrop-blur-lg">
      <nav className="page-wrap flex flex-wrap items-center gap-x-3 gap-y-2 py-3 sm:py-4">
        <div className="min-w-0 flex-1 sm:flex-none">
          <Button asChild variant="secondary" size="sm" className="max-w-full rounded-full px-4">
            <Link to="/">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span className="truncate font-semibold">Sardine Trading Terminal</span>
            </Link>
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
        </div>

        <div className="order-3 flex w-full flex-wrap items-center gap-x-2 gap-y-1 pb-1 text-sm font-semibold sm:order-2 sm:w-auto sm:flex-nowrap sm:pb-0">
          <Link
            to="/"
            className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
            activeProps={{
              className:
                'inline-flex h-9 items-center rounded-md bg-secondary px-3 text-sm text-secondary-foreground',
            }}
          >
            Home
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
            activeProps={{
              className:
                'inline-flex h-9 items-center rounded-md bg-secondary px-3 text-sm text-secondary-foreground',
            }}
          >
            Dashboard
          </Link>
          <Link
            to="/about"
            className="inline-flex h-9 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
            activeProps={{
              className:
                'inline-flex h-9 items-center rounded-md bg-secondary px-3 text-sm text-secondary-foreground',
            }}
          >
            About
          </Link>
        </div>
      </nav>
    </header>
  )
}
