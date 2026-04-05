export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-12 border-t bg-background px-4 pb-10 pt-7 text-muted-foreground">
      <div className="page-wrap flex flex-col gap-3 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <div>
          <p className="m-0 text-sm font-semibold text-foreground">
            Sardine Trading Terminal
          </p>
          <p className="mt-1 text-sm">
            Live agent streams, simulated execution, and AAPL market depth in one view.
          </p>
        </div>
        <div className="text-sm">
          <p className="m-0">&copy; {year} Sardine simulation workspace.</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Mastra runtime • TanStack Start shell
          </p>
        </div>
      </div>
    </footer>
  )
}
