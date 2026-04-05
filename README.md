<h1 align="center">🐟 Sardine</h1>

<p align="center">
  <strong>Multi-Agent Trading Simulation with Real Market Data</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License: Apache 2.0" />
  <img src="https://img.shields.io/badge/node-%3E%3D22.13-339933" alt="Node >=22.13" />
  <img src="https://img.shields.io/badge/runtime-bun-F9A825" alt="Bun" />
  <img src="https://img.shields.io/badge/agents-1000%2B-6F42C1" alt="1000+ Agents" />
  <img src="https://img.shields.io/badge/symbols-S%26P%20500-0052CC" alt="S&P 500" />
</p>

---

## What It Does

Sardine is a **multi-agent trading simulation** that boots from real market data and lets you watch 1,000+ LLM-powered agents trade against each other in a fully operational limit order book matching engine.

- **Alpaca integration** seeds the simulation with real S&P 500 prices, spreads, and 60-day history — then tracks sim-vs-real divergence
- **1,000+ Mastra agents** with unique personas, agendas, and behavioral biases (Goldman Sachs, Bridgewater, "Dave from Ohio") are dynamically spawned from 2 templates using `RuntimeContext`
- **LOB matching engine** runs 500 limit order books with price-time FIFO matching, market + limit orders, and real trade execution
- **Research desk** of 15 agents scrapes financial news, SEC filings, and sentiment via Firecrawl — publishing research notes that influence trading agents
- **Professional trading terminal UI** with live candlestick charts, order book depth, time & sales tape, agent blotter, and sim controls
- **"What-if" chatbot** — describe an event in natural language ("Fed raises rates 0.5%"), inject it into the sim, and watch agents react in real time

---

## Architecture

```
┌──────────────┐     ┌─────────────┐     ┌──────────────────────────────────────┐
│   Alpaca     │────▶│  Bootstrap   │────▶│         TICK LOOP (sim-runner)       │
│  Paper API   │     │  Seed 500    │     │                                      │
│              │     │  symbols +   │     │  1. SimClock advance                 │
│  Real quotes │     │  1000 agents │     │  2. Drain world events               │
│  60d bars    │     └─────────────┘     │  3. Release research notes           │
└──────────────┘                         │  4. Agent generation (50 LLM + 950   │
                                         │     autopilot per tick)               │
                                         │  5. MatchingEngine (500 LOBs)        │
                                         │  6. PortfolioManager reconcile       │
                                         │  7. Batch DB write                   │
                                         │  8. WS broadcast                     │
                                         └──────────────┬───────────────────────┘
                                                        │
                                         ┌──────────────▼───────────────────────┐
                                         │         WebSocket Server (:3001)      │
                                         │   ohlcv:{symbol}  lob:{symbol}       │
                                         │   agents          sim                │
                                         └──────────────┬───────────────────────┘
                                                        │
                                         ┌──────────────▼───────────────────────┐
                                         │       Trading Terminal UI (:3000)     │
                                         │                                       │
                                         │  Candlestick · OrderBook · Watchlist  │
                                         │  Time&Sales · Blotter · Research      │
                                         │  SimControls · What-If Chat           │
                                         └───────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **AI Agents** | [Mastra](https://mastra.ai), Anthropic Claude, Google Gemini |
| **Frontend** | React 19, TanStack Start, TanStack Router, TanStack Table + Virtual |
| **Charts** | lightweight-charts (TradingView), Recharts |
| **Styling** | Tailwind CSS 4, shadcn/ui, Radix UI |
| **Database** | Neon PostgreSQL, Drizzle ORM |
| **Market Data** | Alpaca Paper Trading API |
| **Web Scraping** | Firecrawl |
| **Realtime** | WebSocket (ws), EventEmitter3 |
| **Build** | Vite 7, TypeScript 5.7 |
| **Linting** | Biome |
| **Testing** | Vitest, Testing Library |

---

## Prerequisites

- **Bun** — [install](https://bun.sh)
- **Node.js >=22.13**
- **Neon PostgreSQL database** — [neon.new](https://neon.new) (free tier works)
- **API keys** — Anthropic, Google, Alpaca, Firecrawl (see [Environment Variables](#environment-variables))

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url> sardine && cd sardine
bun install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in your API keys (see [Environment Variables](#environment-variables)).

### 3. Create a Neon database

Go to [neon.new](https://neon.new) and create a free database. Copy the connection string into `DATABASE_URL` in your `.env.local`.

### 4. Push the database schema

```bash
bun run db:push
```

### 5. Start everything

The app has two processes — the **web app** and the **simulation worker**. `dev:full` runs both:

```bash
bun run dev:full
```

Or start them individually:

```bash
bun run dev      # Web app on :3000
bun run sim      # Simulation worker (in another terminal)
```

### 6. Open the terminal

Navigate to [http://localhost:3000](http://localhost:3000). You'll see the Sardine trading terminal dashboard.

---

## Commands

| Command | Description |
|---|---|
| `bun run dev` | Start the web app (Vite dev server on :3000) |
| `bun run dev:full` | Start web app + simulation worker concurrently |
| `bun run sim` | Start the simulation worker only |
| `bun run build` | Production build |
| `bun run preview` | Preview production build |
| `bun run test` | Run all tests |
| `bun run test:trading:fast` | Run trading agent + tools unit tests |
| `bun run test:trading:live` | Run trading agent smoke test (requires API keys) |
| `bun run check-types` | TypeScript type checking (`tsc --noEmit`) |
| `bun run lint` | Lint with Biome |
| `bun run format` | Format with Biome |
| `bun run check` | Full Biome check (lint + format) |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Run Drizzle migrations |
| `bun run db:push` | Push schema directly to database |
| `bun run db:studio` | Open Drizzle Studio (DB browser) |

---

## Environment Variables

Create a `.env.local` file (copy from `.env.example`):

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `DATABASE_URL_POOLER` | No | Neon pooled connection string |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | Google Gemini API key (for Mastra agents) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (for Claude-powered agents) |
| `FIRECRAWL_API_KEY` | Yes | Firecrawl API key (for research agent web scraping) |
| `ALPACA_API_KEY` | Yes | Alpaca paper trading API key |
| `ALPACA_API_SECRET` | Yes | Alpaca paper trading API secret |
| `ALPACA_BASE_URL` | Yes | Alpaca API base URL (default: `https://paper-api.alpaca.markets`) |

> **Important:** Never commit `.env.local` to version control. It's already in `.gitignore`.

---

## Project Structure

```
src/
├── mastra/                   # Mastra AI framework configuration
│   ├── index.ts              # Central Mastra instance
│   ├── agents/
│   │   ├── trading-agent.ts  # Single template → 1000+ trading agent instances
│   │   └── research-agent.ts # Single template → 15 research agent instances
│   └── tools/
│       ├── marketDataTool.ts # Read LOB snapshots
│       ├── portfolioTool.ts  # Read agent positions/P&L
│       ├── orderTool.ts      # Submit orders to matching engine
│       ├── firecrawlTool.ts  # Scrape financial news/filings
│       └── researchPublishTool.ts
│
├── engine/                   # Core simulation engine
│   ├── lob/
│   │   ├── LimitOrderBook.ts # Price-time FIFO order book
│   │   ├── MatchingEngine.ts # Routes orders across 500 LOBs
│   │   └── OrderQueue.ts     # FIFO queue per price level
│   ├── bus/
│   │   ├── EventBus.ts       # Typed event emitter
│   │   └── PublicationBus.ts # Research note queue with tier-based delays
│   └── sim/
│       ├── SimClock.ts       # Logical tick counter + simulated timestamp
│       └── SimOrchestrator.ts# Main tick loop coordinator
│
├── agents/                   # Agent lifecycle & population management
│   ├── factory.ts            # Generates 1000+ agent configs from distributions
│   ├── AgentRegistry.ts      # Agent state + RuntimeContext registry
│   ├── batch-scheduler.ts    # Round-robin: 20 groups of 50
│   ├── autopilot.ts          # Execute structured directives (no LLM)
│   ├── PortfolioManager.ts   # Reconcile trades → update cash/positions/NAV
│   ├── bootstrap.ts          # Sync real S&P 500 from Alpaca → seed state
│   └── persistence.ts        # Agent state persistence
│
├── alpaca/                   # Alpaca paper trading integration
│   ├── client.ts             # Alpaca SDK wrapper
│   ├── live-feed.ts          # Fetch real quotes/bars for 500 symbols
│   └── orderBridge.ts        # Sim signal → Alpaca order API
│
├── server/                   # Backend services
│   ├── sim-runner.ts         # Simulation worker entrypoint
│   ├── ws/
│   │   ├── SimWebSocketServer.ts
│   │   ├── ConnectionManager.ts
│   │   └── broadcaster.ts
│   └── sessions.ts
│
├── components/               # UI components
│   ├── dashboard/
│   │   ├── CandlestickChart.tsx
│   │   ├── OrderBookPanel.tsx
│   │   ├── Watchlist.tsx
│   │   ├── TimeAndSales.tsx
│   │   ├── Blotter.tsx
│   │   ├── SignalFeed.tsx
│   │   ├── ResearchFeed.tsx
│   │   ├── MarketStats.tsx
│   │   ├── TopBar.tsx
│   │   └── AgentsPanel.tsx
│   └── ui/                   # shadcn/ui primitives
│
├── hooks/                    # React hooks for WS + state
│   ├── useSimWebSocket.tsx
│   ├── useMarketData.ts
│   ├── useOrderBook.ts
│   ├── useSimControls.ts
│   ├── useAgentFeed.ts
│   └── ...
│
├── routes/                   # TanStack Router file-based routes
│   ├── dashboard.$sessionId.tsx
│   ├── dashboard.index.tsx
│   └── api/                  # API routes
│
├── db/
│   └── schema.ts             # Full Drizzle schema (11 tables)
│
├── types/                    # TypeScript type definitions
│   ├── agent.ts
│   ├── market.ts
│   ├── sim.ts
│   ├── research.ts
│   └── ws.ts
│
└── lib/
    └── constants.ts          # S&P 500 ticker list, agent configs, defaults
```

---

## How It Works

### Tick Lifecycle

The simulation is **event-driven**, not fixed-interval. A tick only advances when all agent generation is complete — the sim moves at the speed of its slowest LLM call.

```
Each tick:
  1. SimClock advances (logical step, ~5 simulated seconds)
  2. Drain pending world events from queue
  3. Release due research notes to subscribed agents
  4. Agent generation:
     • Active group (50 agents) → parallel LLM calls via Mastra
     • Inactive groups (950 agents) → execute last autopilot directive
  5. MatchingEngine processes all orders across 500 LOBs
  6. PortfolioManager reconciles trades
  7. Batch DB write (orders, trades, ticks, agent updates)
  8. WebSocket broadcast to subscribed clients
```

### Agent Factory — 2 Templates, 1000+ Instances

Instead of 1000 agent files, Sardine defines **2 Mastra Agent templates** (`trading-agent` and `research-agent`). Each instance gets a unique `RuntimeContext` injecting:

- **Persona** — "You are Goldman Sachs' equity desk..." or "You are Dave, a retail trader from Ohio..."
- **Agenda** — Current objectives ("Reduce tech overweight from 35% to 25%")
- **Investment thesis** — Overarching market view
- **Behavioral biases** — Loss aversion, FOMO, herding, overconfidence
- **Constraints** — Position limits, ESG mandates, sector restrictions
- **Model tier** — Sonnet for top institutions, Haiku for the rest

### Round-Robin LLM Scheduling

Agents are split into 20 groups of 50. Each tick, one group calls the LLM (50 parallel calls). The other 19 groups execute deterministic autopilot directives from their last LLM turn. Every agent gets an LLM turn every 20 ticks.

### Alpaca Real-World Bootstrap

On startup, the simulation syncs the full S&P 500 from Alpaca:

- Latest quotes for all 500 tickers
- 60-day price history (OHLCV)
- Real bid/ask spreads seed the opening order books
- Agent starting positions reflect real market structure

The sim starts as a **mirror of reality**. From tick 1, agents diverge from real prices based on their LLM reasoning. **The divergence IS the prediction.**

---

## "What-If" Chatbot

The killer feature. Describe a scenario in natural language and watch the market react.

```
You: "What happens if the Fed raises rates by 0.5%?"
Bot: Injecting event: { type: 'rate_decision', magnitude: -0.03, title: 'Fed raises 50bps' }
     → Watch the candlestick chart — AAPL drops as agents react
     → Goldman reasoning: "Risk-off, reducing tech exposure..."
     → Market maker widens spread from $0.20 to $0.45
     After 10 ticks: "AAPL fell 1.8% from $195.12 to $191.60. Goldman sold 200 shares.
     Market maker spread widened 125%. Momentum agents triggered stop losses."

You: "What if Apple announces a $100B buyback?"
Bot: Injecting event: { type: 'news', magnitude: 0.05, affectedSymbols: ['AAPL'] }
     → Value agents see increased fair value → buying pressure
     → After 10 ticks: "AAPL rose 2.3%. Value agents accumulated 45 shares."

You: "Who's the most profitable agent right now?"
Bot: "Goldman Sachs leads at +$3,240 (+0.65%). momentum-3 is second at +$890.
     noise-1 is worst at -$340. Market maker is flat (expected — they profit on spread)."

You: "Show me Goldman's last 5 decisions"
Bot: Returns Goldman's recent LLM reasoning + trade outcomes from the orders table.
```

---

## Dashboard Layout

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ SARDINE TERMINAL  SIM: OPEN  10:35:00 ET  Tick 1042  Worker ● LIVE  4.2s  [▶][⏸][Step]│
├───────────────┬───────────────────────────────────────────────┬────────────────────────┤
│ WATCHLIST     │ CHART + VOLUME                                │ ORDER BOOK / LADDER    │
│ AAPL 195.12   │ Candlesticks with event markers               │ Ask size  Price  Bid   │
│ MSFT 421.80   │ Intratick updates via WebSocket               │   120    195.14        │
│ NVDA 903.22   │ Volume bars below                             │    80    195.13        │
│ ... 500 syms  │                                               │          195.12   140  │
│ last/chg/vol  │                                               │          195.11   220  │
├───────────────┼───────────────────────────────┬───────────────┼────────────────────────┤
│ TIME & SALES  │ AGENT BLOTTER                │ RESEARCH/NEWS │ WHAT-IF TERMINAL       │
│ 10:35:01 100  │ Goldman BUY 100 AAPL 195.10  │ 10:34 Tech +  │ > Fed raises rates 50  │
│ 10:35:01 200  │ mm-4 QUOTE ask 195.14        │ 10:35 AAPL... │ Drafted event card     │
│ 10:35:02 50   │ citadel SELL 50 MSFT 421.70  │ severity tags │ Queued for next tick   │
│ scrolling tape│ fills / cancels / status     │ symbol-linked │ aftermath + eventId    │
└───────────────┴───────────────────────────────┴───────────────┴────────────────────────┘
```

---

## Database Schema

11 tables power the simulation:

| Table | Purpose |
|---|---|
| `sim_config` | Singleton — running state, tick counter, speed settings |
| `agents` | 1000+ agent rows with persona, positions, NAV, autopilot directives |
| `symbols` | 500 S&P tickers with fundamentals (EPS, PE, market cap, sector) |
| `orders` | Every order per tick (~500–2000/tick) with LLM reasoning |
| `trades` | Matched fills from the LOB engine (~100–500/tick) |
| `ticks` | OHLCV bars per tick (500 rows/tick, one per symbol) |
| `research_notes` | Published research from 15 agents |
| `world_events` | Injected events (chatbot + synthetic + real news) |
| `messages` | Inter-agent communications log |
| `sim_snapshots` | Full state snapshots every 100 ticks for replay |
| `divergence_log` | Sim price vs real Alpaca price per symbol |

---

## License

[Apache 2.0](LICENSE)
