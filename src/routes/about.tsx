import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="rounded-2xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          About
        </p>
        <h1 className="mb-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          Built to watch the market sim think in real time.
        </h1>
        <p className="m-0 max-w-3xl text-base leading-8 text-muted-foreground">
          Sardine is a realtime trading simulation workspace with live market
          data, agent activity, and execution state flowing through a single
          interface. The monitor focuses on streaming agent turns, explicit
          schema-failure visibility, and live AAPL depth so the sim is easier
          to operate and debug.
        </p>
      </section>
    </main>
  )
}
