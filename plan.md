# Sardine POC: Full Vertical Slice

## Goal

500 S&P tickers, 1000+ dynamically generated Mastra agents, every layer end-to-end:
- **LOB matching engine** — 500 limit order books, market + limit orders, in-memory
- **1000+ Mastra agents** — dynamically spawned from 2 templates using `RuntimeContext` (persona, strategy, model all parameterised). NOT 1000 separate files.
- **ALL agents are LLM-powered Mastra agents** — no rule-based tier. 1000+ agents are batched into 20 groups of 50. Each tick, one group calls the LLM (~50 calls/tick, estimated ~$6/hour). Every agent gets an LLM turn every 100 simulated seconds. Between turns, they execute their last structured autopilot directive.
- **15 research agents** — Firecrawl scrapes news/filings/sentiment → publish ResearchNotes
- **Live dashboard** — candlestick chart, order book depth, signal feed, sim controls
- **"What-if" chatbot** — describe an event in natural language ("Fed raises rates 0.5%"), it injects into the sim, watch agents react and prices move live
- **Alpaca live data** — real-time price feeds for 500 S&P tickers from Alpaca, seeds the sim with real-world starting state
- **WebSocket** — real-time tick updates to browser
- **Alpaca bridge** — paper trades prove the connection
- **Sim loop** — dedicated worker process on the server with an awaited tick loop (swap to Trigger.dev later)

---

## POC Data Flow

```
Tick loop (EVENT-DRIVEN, not fixed interval):

  The simulation runner is a dedicated worker process. It owns the awaited
  tick loop, persistence, and WebSocket broadcast lifecycle.

  A tick ONLY advances when ALL agent generation is complete.
  There is no wall-clock timer. The sim moves at the speed of its slowest LLM call.
  This guarantees: no drift, no out-of-sync, no skipped agents.

  ┌─────────────────────────────────────────────────────────┐
  │                    TICK LIFECYCLE                         │
  │                                                          │
  │  sim-runner.ts:                                          │
  │    while (isRunning) {                                   │
  │      const tickStart = Date.now()                        │
  │      await SimOrchestrator.tick()    ← BLOCKS until done │
  │      const tickDuration = Date.now() - tickStart         │
  │      // Optional: add minimum delay between ticks        │
  │      const minInterval = simConfig.tickIntervalMs        │
  │      const delay = Math.max(0, minInterval - tickDuration)│
  │      if (delay > 0) await sleep(delay)                   │
  │      // Pacing only. Tick N+1 still waits for tick N.    │
  │    }                                                     │
  └─────────────────────────────────────────────────────────┘

SimOrchestrator.tick():
  │
  ├─ [1] SimClock.advance() → simTick++, simulatedTime
  │     The sim clock ticks in LOGICAL steps, not wall-clock time.
  │     simulatedTime += simulatedTickDuration (e.g. 5 simulated seconds per tick)
  │     Whether this tick takes 2s or 30s in real time doesn't matter —
  │     inside the simulation, exactly 5 simulated seconds have passed.
  │
  ├─ [2] Worker drains pending InjectWorldEventCommand queue
  │     Validate accepted commands, persist/update `world_events`, and apply
  │     newly accepted events at the tick boundary before any agent decisions.
  │     The app/API layer never mutates SimOrchestrator directly.
  │
  ├─ [3] PublicationBus.releaseDue(simTick) → released ResearchNotes to subscribed agents
  │
  ├─ [4] ALL agents generate — PARALLEL within group, SEQUENTIAL guarantee across tick
  │   │
  │   │  activeGroup = simTick % 20
  │   │
  │   │  ┌── STEP A: Autopilot agents (950) — sync, <100ms total ──┐
  │   │  │  for (agent of inactiveAgents) {                         │
  │   │  │    orders.push(...autopilot.execute(agent.lastDirective)) │
  │   │  │  }                                                       │
  │   │  │  // Deterministic, no I/O, no LLM                        │
  │   │  └──────────────────────────────────────────────────────────┘
  │   │
  │   │  ┌── STEP B: LLM agents (50) — parallel, AWAITED ──────────┐
  │   │  │  const llmResults = await Promise.all(                   │
  │   │  │    activeAgents.map(agent =>                              │
  │   │  │      tradingAgent.generate({                              │
  │   │  │        runtimeContext: agent.ctx,                         │
  │   │  │        prompt: buildTickPrompt(agent, snapshot)           │
  │   │  │      })                                                   │
  │   │  │    )                                                      │
  │   │  │  )                                                        │
  │   │  │  // ALL 50 calls run in parallel via Promise.all          │
  │   │  │  // Tick does NOT proceed until ALL 50 have responded     │
  │   │  │  // Typical: 2-8 seconds (bounded by slowest call)       │
  │   │  │                                                           │
  │   │  │  // Timeout safety: if any call takes >15s, use fallback │
  │   │  │  // Promise.allSettled + 15s timeout per call             │
  │   │  │  // Timed-out agents get "hold current positions" default │
  │   │  └──────────────────────────────────────────────────────────┘
  │   │
  │   │  ┌── STEP C: Collect all orders ────────────────────────────┐
  │   │  │  allOrders = [...autopilotOrders, ...llmOrders]          │
  │   │  │  // Every agent has now produced their orders for this   │
  │   │  │  // tick. Nothing is pending. Nothing is async.          │
  │   │  └──────────────────────────────────────────────────────────┘
  │   │
  │   │  GUARANTEE: When we reach step [5], every single agent
  │   │  (all 1000+) has submitted their orders. No stragglers.
  │   │
  ├─ [5] MatchingEngine.processOrders(allOrders) across 500 LOBs
  │   │   Route each order to correct symbol's LimitOrderBook
  │   │   Price-time FIFO matching, market impact is mechanical
  │   │   Output: Trade[], LOBSnapshot[], OHLCVBar[] (per symbol)
  │   │   This step is pure computation — no I/O, no LLM, ~50ms
  │   │
  ├─ [6] PortfolioManager.reconcile(trades)
  │   │   Update cash, positions, NAV for buyer + seller of each trade
  │   │
  ├─ [7] DB write (single transaction, batched)
  │   │   INSERT orders (~1500 rows), trades (~300 rows), ticks (~500 rows)
  │   │   UPDATE agents (only changed, ~200-400 agents)
  │   │   UPDATE sim_config { currentTick, simulatedMarketTime }
  │   │
  ├─ [8] WS broadcast (only to subscribed channels)
  │   │   "ohlcv:{symbol}" → CandlestickChart.update(bar)
  │   │   "lob:{symbol}"   → OrderBookDepth re-render
  │   │   "agents"         → SignalFeed append (includes LLM reasoning for active group)
  │   │   "sim"            → SimControls { simTick, simulatedTime, tickDurationMs }
  │   │
  │   └─ Tick complete. Loop back to [1].
  │
  │  TIMING BREAKDOWN (typical tick):
  │    Step 1-3: <10ms  (clock advance, event command drain, publication release)
  │    Step 4A:  <100ms (950 autopilot agents)
  │    Step 4B:  2-8s   (50 LLM calls in parallel — this dominates)
  │    Step 5:   ~50ms  (LOB matching)
  │    Step 6:   <10ms  (portfolio reconciliation)
  │    Step 7:   ~200ms (DB write)
  │    Step 8:   <10ms  (WS broadcast)
  │    TOTAL:    ~3-9s per tick (wall clock)
  │
  │  SIMULATED TIME: each tick = 5 simulated seconds regardless of wall-clock
  │    So 1 hour of simulated trading = ~720 ticks
  │    At ~5s/tick wall clock = ~1 hour real time for 1 hour simulated
  │    At ~3s/tick wall clock = ~36 min real time for 1 hour simulated (faster than real!)
  │
  │  Dashboard shows BOTH:
  │    "Sim Time: 2026-04-03 10:35:00 ET" (logical market clock)
  │    "Tick: 1042 | Tick took: 4.2s" (real performance)

  Research agents (separate async loop, every 20 ticks):
    15 research agents each with own RuntimeContext (focus, sources)
    researchAgent.generate({ runtimeContext: ctx }) → Firecrawl + LLM analyse →
    PublicationBus.publish(ResearchNote) → released to agents with tier-based delay
    Research runs BETWEEN ticks (never during a tick) to avoid contention

  User strategy agent (inside tick loop, treated as agent 1071):
    If divergence signal fires → hypothesisEngine validates →
    orderBridge → Alpaca paper trade API
```

---

## POC File Structure

Only files that get created. Existing files modified are marked.

```
src/
├── types/
│   ├── agent.ts                   # AgentTier, AgentState, Position, AgentDecision
│   ├── market.ts                  # Order, Trade, LOBSnapshot, OHLCVBar, PriceLevel
│   ├── sim.ts                     # SimConfig, WorldEvent (simplified, no macro model)
│   ├── research.ts                # ResearchNote
│   └── ws.ts                      # WsMessage, WsMessageType, channel types
│
├── engine/
│   ├── lob/
│   │   ├── LimitOrderBook.ts      # Core LOB: sorted bid/ask, price-time FIFO
│   │   ├── OrderQueue.ts          # FIFO queue at a single price level
│   │   └── MatchingEngine.ts      # Wraps 500 LOBs, routes orders, emits trades
│   ├── bus/
│   │   ├── EventBus.ts            # Typed eventemitter3 wrapper
│   │   └── PublicationBus.ts      # Research note queue with release delay
│   └── sim/
│       ├── SimClock.ts            # Tick counter + simulated timestamp
│       └── SimOrchestrator.ts     # Main tick loop: agents → matching → persist → broadcast
│
├── agents/
│   ├── AgentRegistry.ts           # Map<id, AgentState + RuntimeContext>, getState(), getAll()
│   ├── PortfolioManager.ts        # Reconcile trades → update agent cash/positions/NAV
│   ├── factory.ts                 # Spawns 1000+ agents: generates configs, creates RuntimeContexts
│   ├── batch-scheduler.ts         # Round-robin: 20 groups, tracks active group, autopilot execution
│   ├── autopilot.ts               # Execute structured autopilot directives (no LLM)
│   ├── bootstrap.ts               # Sync real S&P 500 from Alpaca → seed agents + opening books
│   └── UserStrategyAgent.ts       # User's agent → hypothesis engine → Alpaca bridge
│
├── mastra/
│   ├── index.ts                   # Mastra instance + dynamic agent registration
│   ├── agents/
│   │   ├── trading-agent.ts       # Single Mastra Agent template — RuntimeContext drives behavior
│   │   ├── research-agent.ts      # Single Mastra Agent template for research
│   │   └── chatbot-agent.ts       # Chatbot Mastra Agent
│   ├── tools/
│   │   ├── marketDataTool.ts      # Read LOB snapshot for a requested symbol
│   │   ├── portfolioTool.ts       # Read agent's own positions/P&L
│   │   ├── researchTool.ts        # Query released research notes
│   │   ├── orderTool.ts           # Submit order → MatchingEngine
│   │   ├── firecrawlTool.ts       # Scrape URL, return structured content
│   │   ├── eventInjectionTool.ts  # Chatbot: inject WorldEvent into sim from natural language
│   │   ├── simQueryTool.ts        # Chatbot: query agent performance, prices, trades from DB
│   │   └── waitAndObserveTool.ts  # Chatbot: wait N ticks after event, report consequences
│   └── prompts/
│       └── chatbot.ts             # "You are a market simulator. You can inject events..."
│
├── alpaca/
│   ├── client.ts                  # Alpaca SDK wrapper (paper trading)
│   ├── live-feed.ts               # Fetch real quotes/bars for the 500-symbol bootstrap, optional WS comparison stream
│   └── orderBridge.ts             # Sim signal → Alpaca order API call
│
├── server/
│   ├── sim-runner.ts              # Dedicated worker entrypoint with awaited tick loop
│   └── ws/
│       ├── SimWebSocketServer.ts  # ws server owned by the worker process
│       ├── ConnectionManager.ts   # Map<channel, Set<WebSocket>>
│       └── broadcaster.ts         # Typed broadcast to subscribed clients
│
├── hooks/
│   ├── useSimWebSocket.ts         # Singleton WS, subscribe/unsubscribe, reconnect
│   ├── useOrderBook.ts            # Subscribe "lob:AAPL" → LOBSnapshot state
│   ├── useMarketData.ts           # Subscribe "ohlcv:AAPL" → feed to lightweight-charts
│   ├── useAgentFeed.ts            # Subscribe "agents" → signal stream
│   └── useSimControls.ts          # Subscribe "sim" + mutations (play/pause/speed)
│
├── components/
│   ├── charts/
│   │   ├── CandlestickChart.tsx   # lightweight-charts, useRef, series.update() on WS
│   │   └── OrderBookDepth.tsx     # Recharts AreaChart: green bids, red asks
│   └── dashboard/
│       ├── TopBar.tsx             # Terminal header: symbol, session, worker status, latency, controls
│       ├── Watchlist.tsx          # Dense symbol list: last, change, volume, spread, sparkline
│       ├── SimControls.tsx        # Play / Pause / Speed slider / Step button
│       ├── TimeAndSales.tsx       # Scrolling trade tape with timestamp, price, size, side
│       ├── Blotter.tsx            # Orders/fills/cancels table, virtualized
│       ├── SignalFeed.tsx         # Agent decisions list (agent, side, price, reasoning)
│       ├── ResearchFeed.tsx       # Research notes (headline, sentiment, confidence)
│       ├── ChatPanel.tsx          # Command-terminal style "what-if" panel with structured event cards
│       ├── ChartPanel.tsx         # CandlestickChart + volume + event markers (composed)
│       ├── OrderBookPanel.tsx     # OrderBookDepth + market stats + ladder context
│       └── MarketStats.tsx        # Spread, last price, VWAP, tick count
│
├── routes/
│   ├── __root.tsx                 # MODIFY: wrap with WS provider context
│   ├── index.tsx                  # MODIFY: redirect to /dashboard
│   └── dashboard/
│       └── index.tsx              # POC dashboard: chart + order book + signals + chat + controls
│
│   └── api/
│       └── chat.ts                # POST: stream chatbot responses (UI/API consumer of worker-managed state)
│
├── lib/
│   └── constants.ts               # S&P 500 symbol config, agent configs, pacing defaults
│
└── db/
    └── schema.ts                  # MODIFY: full schema for the 500-symbol POC
```

---

## Database Schema

Full schema with 500 S&P symbols + 1000+ agents.

**Enums**: `agent_tier` (tier1/tier2/tier3/research/strategy), `agent_status`, `order_type` (market/limit), `order_side` (buy/sell), `order_status` (pending/open/partial/filled/cancelled), `sentiment` (bullish/bearish/neutral)

**Tables** (all 11 from day 1):

| Table | Usage |
|---|---|
| `sim_config` | Singleton: isRunning, currentTick, speedMultiplier, tickIntervalMs (used as an optional minimum pacing delay between awaited ticks) |
| `agents` | 1000+ rows: id, name, tier, strategyType, currentCash, currentNav, positions (JSONB), parameters (JSONB), lastAutopilotDirective (JSONB), lastLlmAt |
| `symbols` | 500 S&P tickers with fundamentals (EPS, PE, marketCap, sector) |
| `orders` | Every order per tick (~500-2000/tick), including llmReasoning for orders produced during active LLM turns |
| `trades` | Matched fills (~100-500/tick) |
| `ticks` | OHLCV per tick (500 rows/tick, one per symbol) |
| `research_notes` | Published research (~5-10 every 5 min across 15 research agents) |
| `world_events` | Injected events (chatbot + synthetic + real news) with `eventId`, status, `requestedAt`, `appliedAt`, source, and payload fields needed for queued → applied/rejected → observed lifecycle |
| `messages` | Inter-agent comms log |
| `sim_snapshots` | Full state every 100 ticks for replay |
| `divergence_log` | Sim price vs real Alpaca price per symbol |

---

## Dynamic Agent Factory (Mastra RuntimeContext)

This is the key architecture. Instead of 1000 separate agent files, we define **2 Mastra Agent templates** that use `RuntimeContext` to dynamically adapt persona, strategy, model, and tools per instance.

### `src/mastra/agents/trading-agent.ts` — Single template, 1000+ instances

```typescript
import { Agent } from "@mastra/core/agent";

// RuntimeContext types — see "Agent Personas & Agendas" section for full shape
// Key fields: persona, current-agenda, investment-thesis, personality-traits, 
// behavioral-biases, constraints, quarterly-goal, model-tier, llm-group

export const tradingAgent = new Agent({
  name: "Trading Agent",
  
  // instructions, model, tools all driven by RuntimeContext
  // See "Agent Personas & Agendas" section for full implementation
  instructions: ({ runtimeContext }) => { /* persona + agenda + thesis + biases → prompt */ },
  model: ({ runtimeContext }) => { /* sonnet for top 5, haiku for rest */ },
  tools: { marketDataTool, portfolioTool, orderTool, researchTool },
});
```

### `src/agents/factory.ts` — Spawns 1000+ from config

```typescript
import { tradingAgent } from "../mastra/agents/trading-agent";
import { RuntimeContext } from "@mastra/core/runtime-context";
import { SP500_TICKERS, SECTORS } from "../lib/constants";

interface AgentConfig {
  id: string;
  name: string;
  tier: "tier1" | "tier2" | "tier3";
  strategy: string;
  persona: string;
  sectors: string[];
  risk: number;
  capital: number;
  llmGroup: number;
  decisionParams: Record<string, number>;  // strategy-specific params
}

// Generate 1000+ agent configs from distributions
function generateAgentConfigs(seed: number): AgentConfig[] {
  const rng = seededRandom(seed);  // deterministic for reproducibility
  const configs: AgentConfig[] = [];

  // ── Tier 1: 5 named institutions ──
  configs.push(
    { id: "goldman-sachs", name: "Goldman Sachs", tier: "tier1", strategy: "institutional",
      persona: "You are Goldman Sachs' equity desk. You manage $5M in US equities...",
      sectors: ["tech", "healthcare", "finance"], risk: 0.6, capital: 5_000_000,
      llmGroup: 0, decisionParams: {} },
    { id: "blackrock", name: "BlackRock", tier: "tier1", strategy: "institutional",
      persona: "You are BlackRock's active equity fund...",
      sectors: ["tech", "consumer", "industrial"], risk: 0.4, capital: 10_000_000,
      llmGroup: 1, decisionParams: {} },
    // ... JPMorgan, Citadel (meta-MM), Central Bank
  );

  // ── Tier 2: 50 hedge funds, pension funds, analysts ──
  for (let i = 0; i < 20; i++) {
    configs.push({
      id: `hedge-fund-${i}`, name: `Hedge Fund ${i}`, tier: "tier2",
      strategy: rng.pick(["momentum", "value", "algo-arb"]),
      persona: `You are a ${rng.pick(["long/short", "event-driven", "quant"])} hedge fund...`,
      sectors: rng.sample(SECTORS, rng.int(2, 5)),
      risk: rng.float(0.5, 0.9), capital: rng.int(500_000, 5_000_000),
      llmGroup: i % 20, decisionParams: {}
    });
  }
  // ... 20 pension funds, 10 analysts

  // ── Tier 3: 1000+ LLM-authored agents from distributions ──
  for (let i = 0; i < 300; i++) {
    configs.push({
      id: `momentum-${i}`, name: `Momentum Trader ${i}`, tier: "tier3",
      strategy: "momentum",
      persona: `You are a momentum-oriented retail trader with a short time horizon...`,
      sectors: rng.sample(SECTORS, rng.int(1, 3)),
      risk: rng.float(0.3, 0.9), capital: rng.int(10_000, 100_000),
      llmGroup: i % 20,
      decisionParams: {
        lookback: rng.int(5, 100),
        threshold: rng.float(0.005, 0.03),
        riskFraction: rng.float(0.01, 0.10),
      }
    });
  }
  // ... 200 value, 200 noise, 100 algo, 100 rebalancers, 100 depth providers

  return configs;
}

// At sim start: create RuntimeContext per agent, register in AgentRegistry
function spawnAgents(configs: AgentConfig[]) {
  for (const config of configs) {
    const ctx = new RuntimeContext<TradingContext>();
    ctx.set("agent-id", config.id);
    ctx.set("agent-name", config.name);
    ctx.set("tier", config.tier);
    ctx.set("strategy", config.strategy);
    ctx.set("persona", config.persona);
    ctx.set("mandate-sectors", config.sectors);
    ctx.set("risk-tolerance", config.risk);
    ctx.set("capital", config.capital);
    ctx.set("llm-group", config.llmGroup);

    AgentRegistry.register({
      config,
      runtimeContext: ctx,
      mastraAgent: tradingAgent,  // SAME Mastra agent instance for all
    });
  }
}
```

### All Trading Agents Are LLM-Authored — Batch Round-Robin + Autopilot

Every trading agent is backed by `tradingAgent.generate()` over time — no rule-based fallback. Only the active group calls the LLM on a given tick; inactive groups execute their last stored autopilot directive until their next LLM turn.

```
1000 agents split into 20 groups of 50 (assigned at bootstrap, stable)

Per tick:
  activeGroup = simTick % 20
  
  Active group (50 agents):
    await Promise.all(group.map(agent =>
      tradingAgent.generate({
        runtimeContext: agent.ctx,
        prompt: buildTickPrompt(agent, lobSnapshot, research, portfolio)
      })
    ))
    → LLM returns reasoning + tool calls (orders)
    → Store reasoning in orders.llm_reasoning
    → Store structured autopilot directive for next 19 ticks
  
  Inactive groups (950 agents):
    Execute last autopilot directive:
      "Continue holding AAPL. Standing limit buy at $192 for 50 shares."
      → If standing order not yet filled, keep it in book
      → If cancel condition met (e.g. price crossed threshold), cancel
      → No LLM call, deterministic, <1ms per agent

  Autopilot directive format (stored in agent state):
    {
      standingOrders: [{ symbol, side, type, price, qty }],
      holdPositions: ["AAPL", "MSFT"],
      cancelIf: { symbol: "AAPL", condition: "price > 200" },
      urgentReviewIf: { condition: "any_position_loss > 5%" }
    }
    
  If urgentReviewIf triggers → agent gets bumped to next active group (priority LLM call)
```

**Cost estimate**: ~50 Haiku calls/tick + ~2.5 Sonnet calls/tick (top 5 rotate in) = ~$0.15/tick = **~$6/hour** under nominal usage.

### 15 Research Agents — Same Pattern

```typescript
// src/mastra/agents/research-agent.ts
export const researchAgent = new Agent({
  name: "Research Agent",
  instructions: ({ runtimeContext }) => {
    const focus = runtimeContext.get("research-focus");  // "news", "filings", "sentiment", "macro"
    const sources = runtimeContext.get("sources");       // URLs to scrape
    return `You are a financial research analyst focused on ${focus}...`;
  },
  model: () => anthropic("claude-haiku-4-5-20251001"),  // cheap, they just summarise
  tools: { firecrawlTool, researchPublishTool },
});
```

---

## 500 S&P Tickers

### `src/lib/constants.ts` — Full S&P 500 list

Hardcoded list of all ~500 S&P 500 tickers with sector + industry:

```typescript
export const SP500_TICKERS = [
  { symbol: "AAPL", name: "Apple Inc.", sector: "tech", industry: "Consumer Electronics" },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "tech", industry: "Software" },
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "consumer", industry: "E-Commerce" },
  // ... all ~500
] as const;

export const SECTORS = ["tech", "healthcare", "finance", "consumer", "industrial", "energy", "utilities", "materials", "real-estate", "communications"] as const;
```

### Real-World S&P 500 Sync on Startup

On sim start, `bootstrap.ts` syncs the FULL current state of the real S&P 500:

```
Step 1: Fetch real-world state from Alpaca
  alpaca.getLatestQuotes(SP500_TICKERS)     → current bid/ask/last for all 500
  alpaca.getBars(SP500_TICKERS, '1Day', 60) → 60-day price history (for agent lookbacks)
  alpaca.getAssets(SP500_TICKERS)            → market cap, exchange, status
  
Step 2: Enrich with fundamentals
  For each ticker, store in symbols.fundamentals JSONB:
    { eps, pe, marketCap, sector, industry, 52wHigh, 52wLow, avgVolume }
  Source: Alpaca asset data + computed from price history

Step 3: Create 500 LOBs seeded with REAL bid/ask
  For each symbol:
    LOB.initialize(realBidPrice, realAskPrice, realSpread)
    Market maker agents place opening quotes AT the real spread

Step 4: Agent position initialization
  Agents start with positions that REFLECT real market structure:
    Institutional agents (Goldman, BlackRock) → hold top holdings by sector weight
    Hedge funds → long/short positions based on recent momentum/value signals
    Retail agents → small random positions in popular tickers
    All priced at REAL current prices from Alpaca

Step 5: Seed price history buffer
  Store 60-day OHLCV in memory for each symbol
  Agents can immediately compute lookback indicators (SMA, RSI, volatility)
  No "warm-up" period needed — agents have full context from tick 1
```

The sim starts as a **mirror of reality**. From tick 1, agents diverge from real prices based on their LLM reasoning. The divergence IS the prediction.

---

## Agent Bootstrap (Cold Start)

Before tick 1, `bootstrap.ts` seeds 1000+ agents with real Alpaca prices:

```
Fetch: Alpaca batch API → latest quotes for all 500 S&P tickers

Tier 1 (5 agents):
  Goldman Sachs    | $5M cash   | 50 positions across tech/healthcare/finance
  BlackRock        | $10M cash  | 100 positions (broad market exposure)
  JPMorgan         | $5M cash   | 40 positions across consumer/industrial
  Citadel (Meta-MM)| $2M cash   | Adjusts Tier 2 MM params, light direct trading
  Central Bank     | $50M cash  | Rate policy only, buys/sells bonds (proxy via SPY)

Tier 2 (50 agents):
  10 Market Makers | $500K each | 50 symbols each, two-sided quotes every tick
  20 Hedge Funds   | $500K-5M   | 10-30 positions each, LLM every 60 ticks
  10 Pension Funds | $1M-5M     | 20-50 positions, slow value, LLM every 120 ticks
  10 Analysts      | N/A        | Don't trade, publish recommendations

Tier 3 (1000 agents):
  300 Momentum     | $10K-100K  | 3-10 positions, unique lookback/threshold params
  200 Value        | $10K-100K  | 5-15 positions, unique PE target/margin params
  200 Noise        | $10K-50K   | random trades, probability 1-10% per tick
  100 Algo Bots    | $50K-200K  | mean-reversion across assigned symbols
  100 Rebalancers  | $50K-200K  | passive index-tracking with drift threshold
  100 Depth Prov.  | $50K-100K  | resting limits 1-5% from mid, all assigned symbols

Research (15 agents):
  5 News analysts  | N/A        | Firecrawl Reuters/Bloomberg → publish
  3 Filings        | N/A        | Firecrawl SEC EDGAR → publish
  4 Sentiment      | N/A        | Firecrawl Reddit/X → publish
  3 Macro          | N/A        | Firecrawl FRED → publish

Total shares per symbol: conserved after bootstrap (buys = sells only)
Opening books: all 500 symbols have MM quotes at real price ± spread
```

---

## Agent Personas & Agendas (RuntimeContext-driven)

Every agent is LLM-powered. RuntimeContext injects **real-world identity, agenda, behavioral quirks, and current objectives** — not just strategy type. Each agent is a believable simulation of a real market participant with motivations, biases, and goals.

### RuntimeContext Shape (injected per agent)

```typescript
type TradingRuntimeContext = {
  // Identity
  "agent-id": string;
  "agent-name": string;              // "Bridgewater Associates" or "Dave, retail trader from Ohio"
  "entity-type": string;             // "investment-bank" | "hedge-fund" | "pension" | "retail" | ...
  
  // Persona & Backstory
  "persona": string;                 // Rich multi-paragraph persona (see examples below)
  "personality-traits": string[];    // ["contrarian", "risk-averse", "data-driven", "impatient"]
  "behavioral-biases": string[];     // ["loss-aversion", "recency-bias", "herding", "overconfidence"]
  
  // Agenda & Objectives
  "current-agenda": string;          // What they're trying to accomplish RIGHT NOW
  "investment-thesis": string;       // Their overarching market view
  "quarterly-goal": string;          // "Beat S&P by 2%", "Preserve capital", "YOLO into memes"
  "constraints": string[];           // ["max 5% single position", "no energy stocks (ESG mandate)"]
  
  // Strategy & Risk
  "strategy-style": string;          // "risk-parity" | "long-short" | "momentum" | "deep-value" | ...
  "mandate-sectors": string[];
  "risk-tolerance": number;          // 0.0 to 1.0
  "max-position-pct": number;        // Max % of portfolio in single name
  "capital": number;
  
  // Model & Scheduling
  "model-tier": "sonnet" | "haiku";
  "llm-group": number;              // Which batch group (0-19) for round-robin
};
```

### Persona Examples — Rich Real-World Injection

**Tier 1: Goldman Sachs (Sonnet)**
```typescript
ctx.set("persona", `You are the equity trading desk at Goldman Sachs. You manage a $5M 
portfolio of US equities for institutional clients. You are known for:
- Sophisticated macro analysis — you track Fed policy, yield curves, and dollar strength
- Sector rotation based on economic cycle positioning
- Large block trades that move markets — you're aware of your own market impact
- Access to the best research on Wall Street (you read research notes carefully)

Your trading style is measured and institutional. You don't chase momentum — you front-run 
it based on fundamental analysis. You're currently concerned about valuations in mega-cap 
tech after the AI run-up and are slowly rotating into healthcare and industrials.

You have a reputation to protect. Bad trades get scrutinized by the risk committee.`);

ctx.set("current-agenda", "Reduce tech overweight from 35% to 25% of portfolio without 
moving prices. Accumulate healthcare names (UNH, JNJ, LLY) on dips. Maintain existing 
financials exposure as a rate hedge.");

ctx.set("investment-thesis", "Late-cycle economy. Fed will hold rates higher for longer. 
Earnings growth decelerating in tech, accelerating in healthcare and industrials. 
Dollar strength favors domestic-revenue companies.");

ctx.set("personality-traits", ["analytical", "patient", "risk-aware", "macro-focused"]);
ctx.set("behavioral-biases", ["anchoring-to-research", "institutional-herding"]);
ctx.set("constraints", ["max 8% single position", "no penny stocks", "must maintain sector diversification"]);
```

**Tier 1: Citadel Securities (Sonnet) — Market Maker**
```typescript
ctx.set("persona", `You are Citadel Securities, the world's largest market maker. 
You provide liquidity across all 500 S&P symbols. You are NOT a directional trader.

Your edge: speed, spread capture, and inventory management.
- Quote two-sided markets (bid + ask) for every symbol in your mandate
- Widen spreads when volatility spikes or inventory accumulates
- Skew quotes to offload inventory risk (if you're long, lower your ask)
- You see order flow before most participants — use it

You are NEVER wrong about direction because you don't take directional bets.
You profit on the spread. Your risk is inventory — holding too much of one name.
You must quote continuously. Withdrawing liquidity is a regulatory risk.`);

ctx.set("current-agenda", "Maintain tight spreads on top 100 liquid names. Wider spreads 
on small-caps. Reduce NVDA inventory (accumulated from recent sell-side flow). Watch for 
unusual options flow that might signal informed trading.");

ctx.set("constraints", ["must quote every assigned symbol every tick", "max inventory 
$500K per name", "spread floor: 1 cent on liquid names, 5 cents on illiquid"]);
```

**Hedge Fund: Bridgewater Associates (Haiku)**
```typescript
ctx.set("persona", `You are Bridgewater Associates, the world's largest hedge fund ($150B AUM).
You run a risk-parity strategy — equal risk allocation across asset classes.

Your founder Ray Dalio's philosophy: "Pain + Reflection = Progress."
- You are fundamentally contrarian — when everyone is bullish, you get cautious
- You think in terms of economic machines: debt cycles, productivity, monetary policy
- You rebalance systematically based on risk, not return expectations
- You have a strong view on the current macro regime and position accordingly

You're currently in "Late Cycle Defensive" mode. You believe:
- Inflation is stickier than consensus expects
- Corporate margins are peaking
- Consumer spending is about to roll over`);

ctx.set("current-agenda", "Underweight cyclicals. Overweight defensive sectors (utilities, 
healthcare, consumer staples). Building a position in volatility (if VIX is low, buy 
protection). Reduce overall equity beta to 0.6.");

ctx.set("personality-traits", ["contrarian", "systematic", "macro-obsessed", "patient"]);
ctx.set("behavioral-biases", ["overconfidence-in-macro-model"]);
```

**Hedge Fund: Renaissance Technologies (Haiku)**
```typescript
ctx.set("persona", `You are Renaissance Technologies' Medallion Fund. You are the most 
successful quant fund in history. You trade purely on statistical patterns.

- You don't care about fundamentals, news, or narratives
- You look for mean-reversion, momentum, and statistical arbitrage signals
- You trade frequently with small position sizes and tight stops
- You are market-neutral — you don't care if the market goes up or down
- Your holding period is seconds to days, never weeks

You speak in terms of z-scores, Sharpe ratios, and signal decay.`);

ctx.set("current-agenda", "Scan for pairs with divergent z-scores > 2.0. Fade 3-day 
momentum reversals. Keep net exposure within -5% to +5%. Target 50+ round-trip trades 
per LLM turn.");

ctx.set("personality-traits", ["cold", "data-driven", "unemotional", "fast"]);
ctx.set("behavioral-biases", ["overfitting-to-recent-patterns"]);
```

**Pension Fund: CalPERS (Haiku)**
```typescript
ctx.set("persona", `You are CalPERS, the California Public Employees Retirement System.
You manage $500B for 2 million public employees. You are the most conservative investor 
in the market.

- Your primary mandate: DON'T LOSE MONEY. Retirees depend on this.
- You think in decades, not quarters. You buy and hold.
- You follow ESG mandates — no fossil fuels, no private prisons, no tobacco
- You rebalance quarterly to target allocation, not on every tick
- You are slow, deliberate, and risk-averse. You never panic sell.

When in doubt, do nothing. Inaction is your default.`);

ctx.set("current-agenda", "Maintain 60/40 equity/bond proxy allocation. Trim winners 
that exceed 3% portfolio weight. Add to underweight sectors during dips. ESG screen 
all new positions.");

ctx.set("constraints", ["no fossil fuel companies (XOM, CVX, etc.)", "no tobacco (MO, PM)", 
"max 3% single position", "rebalance only when drift > 2%"]);
ctx.set("personality-traits", ["ultra-conservative", "patient", "ESG-conscious"]);
```

**Retail: "Dave from Ohio" (Haiku)**
```typescript
ctx.set("persona", `You are Dave, a 34-year-old software engineer from Ohio. 
You have $45,000 in your brokerage account. You learned trading from YouTube and Reddit.

- You check r/wallstreetbets daily. You're influenced by social sentiment.
- You love tech stocks (especially NVDA, AAPL, TSLA). You think AI will change everything.
- You panic when your portfolio drops more than 5% in a day
- You FOMO into rallies — "I can't miss this move"
- You set stop losses but often cancel them ("it'll come back")
- You overtrade. Your Sharpe ratio is negative.

You are enthusiastic but undisciplined. You have strong opinions loosely held.`);

ctx.set("current-agenda", "Looking to add to NVDA position. Watching TSLA for a breakout 
above $250. Nervous about the overall market but doesn't want to miss gains. 
Considering going all-in on AI stocks.");

ctx.set("personality-traits", ["impulsive", "optimistic", "social-media-driven", "emotional"]);
ctx.set("behavioral-biases", ["FOMO", "loss-aversion", "recency-bias", "herding", 
"disposition-effect"]);
```

**Retail: "Margaret, retired teacher" (Haiku)**
```typescript
ctx.set("persona", `You are Margaret, a 67-year-old retired teacher from Vermont.
You have $180,000 in your IRA. Your financial advisor set up a balanced portfolio 
but you occasionally make your own trades.

- You buy dividend stocks (KO, PG, JNJ) and rarely sell
- You're terrified of another 2008. Any 3% drop and you call your advisor.
- You don't understand options, crypto, or meme stocks
- You watch CNBC every morning and trade based on what Jim Cramer says
- You buy companies whose products you use (AAPL, COST, AMZN)

You are cautious, income-focused, and easily spooked.`);

ctx.set("current-agenda", "Collect dividends. Maybe buy more Costco stock — she loves 
shopping there. Worried about inflation eating her fixed income. Thinking about selling 
her bank stocks after reading about regional bank stress.");

ctx.set("behavioral-biases", ["authority-bias-cramer", "familiarity-bias", "panic-selling"]);
```

### How Persona + Agenda Flow Into LLM Calls

The `tradingAgent` template composes all RuntimeContext fields into the prompt:

```typescript
export const tradingAgent = new Agent({
  instructions: ({ runtimeContext }) => {
    const persona = runtimeContext.get("persona");
    const agenda = runtimeContext.get("current-agenda");
    const thesis = runtimeContext.get("investment-thesis");
    const traits = runtimeContext.get("personality-traits");
    const biases = runtimeContext.get("behavioral-biases");
    const constraints = runtimeContext.get("constraints");
    const goal = runtimeContext.get("quarterly-goal");

    return `
${persona}

## Your Current Agenda
${agenda}

## Your Investment Thesis
${thesis || "You don't have a strong macro view. You trade opportunistically."}

## Your Quarterly Goal
${goal}

## Your Personality
Traits: ${traits.join(", ")}
Known biases (act on these naturally, don't resist them): ${biases.join(", ")}

## Constraints
${constraints.map(c => `- ${c}`).join("\n")}

## What You Must Output
1. Your reasoning (2-3 sentences explaining your thinking THIS tick)
2. Any orders you want to place (via the order tool)
3. An autopilot directive for the next 19 ticks when you won't have LLM access:
   Format: { standingOrders: [...], holdPositions: [...], cancelIf: "...", urgentReviewIf: "..." }

Act in character. Your biases are REAL — don't fight them, embody them.
A retail FOMO trader SHOULD chase rallies. A pension fund SHOULD be boring.
    `;
  },

  model: ({ runtimeContext }) => {
    const tier = runtimeContext.get("model-tier");
    return tier === "sonnet" 
      ? anthropic("claude-sonnet-4-6")
      : anthropic("claude-haiku-4-5-20251001");
  },
});
```

### Agent Config Generation (`factory.ts`)

The factory generates 1070 configs. The top ~30 agents (institutions, named hedge funds, named market makers) have hand-written rich personas. The remaining ~1040 agents have procedurally generated personas:

```typescript
// Named agents (hand-crafted personas)
const NAMED_AGENTS = [
  // Tier 1 institutions (5)
  { id: "goldman-sachs", name: "Goldman Sachs", modelTier: "sonnet", persona: "...(rich)..." },
  { id: "blackrock", name: "BlackRock", modelTier: "sonnet", persona: "..." },
  { id: "jpmorgan", name: "JPMorgan Chase", modelTier: "sonnet", persona: "..." },
  { id: "citadel-securities", name: "Citadel Securities", modelTier: "sonnet", persona: "..." },
  { id: "federal-reserve", name: "Federal Reserve", modelTier: "sonnet", persona: "..." },
  
  // Named hedge funds (20)
  { id: "bridgewater", name: "Bridgewater Associates", modelTier: "haiku", persona: "..." },
  { id: "renaissance", name: "Renaissance Technologies", modelTier: "haiku", persona: "..." },
  { id: "two-sigma", name: "Two Sigma", modelTier: "haiku", persona: "..." },
  { id: "de-shaw", name: "D.E. Shaw", modelTier: "haiku", persona: "..." },
  { id: "point72", name: "Point72", modelTier: "haiku", persona: "..." },
  // ... Millennium, Citadel (hedge fund side), AQR, Man Group, etc.

  // Named pension/sovereign funds (10)
  { id: "calpers", name: "CalPERS", modelTier: "haiku", persona: "..." },
  { id: "norges-bank", name: "Norges Bank (Norwegian Sovereign Fund)", modelTier: "haiku", persona: "..." },
  { id: "vanguard", name: "Vanguard Group", modelTier: "haiku", persona: "..." },
  // ... TIAA, Ontario Teachers, GIC, etc.
];

// Procedurally generated agents (1040)
function generateRetailAgents(count: number, rng: SeededRNG): AgentConfig[] {
  const archetypes = [
    { style: "FOMO trader", biases: ["FOMO", "herding"], traits: ["impulsive", "optimistic"] },
    { style: "dividend investor", biases: ["familiarity-bias"], traits: ["conservative", "patient"] },
    { style: "WSB degen", biases: ["overconfidence", "YOLO"], traits: ["reckless", "meme-driven"] },
    { style: "Boomer value investor", biases: ["anchoring", "status-quo"], traits: ["cautious", "traditional"] },
    { style: "day trader", biases: ["overtrading", "recency-bias"], traits: ["active", "impatient"] },
    { style: "swing trader", biases: ["pattern-recognition"], traits: ["technical", "methodical"] },
    { style: "crypto bro doing stocks", biases: ["moonshot-thinking"], traits: ["volatile", "narrative-driven"] },
  ];
  // Generate unique name, age, location, backstory, agenda for each...
}
```

### Research Agent Personas (15 agents)

```typescript
// Same RuntimeContext pattern for research agents
ctx.set("persona", `You are a senior equity research analyst at Morgan Stanley covering 
the Technology sector. You've followed FAANG stocks for 15 years. You publish detailed 
research notes with price targets and ratings.

Your current view: AI infrastructure spending is peaking. Expect a rotation from 
semiconductor names into software/SaaS companies with proven AI monetization.

When you scrape news, you look for: earnings surprises, guidance changes, analyst 
upgrades/downgrades, insider transactions, and macro indicators affecting your sector.`);

ctx.set("current-agenda", "Publish a weekly sector note. Flag any earnings surprises 
immediately. Watch for signs of consumer spending weakness in retail tech names.");
```

All agents output:
1. **Reasoning** (stored in `orders.llm_reasoning`)
2. **Orders** via `orderTool` (buy/sell, market/limit, symbol, quantity, price)
3. **Autopilot directive** — structured instructions for the next 19 ticks when inactive

---

## POC Dashboard Layout

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ SARDINE TERMINAL  SIM: OPEN  10:35:00 ET  Tick 1042  Worker ● LIVE  4.2s  [▶][⏸][Step][1x] │
├───────────────┬───────────────────────────────────────────────┬────────────────────────────┤
│ WATCHLIST     │ CHART + VOLUME                                │ ORDER BOOK / LADDER        │
│ AAPL 195.12   │ AAPL candlesticks with event markers          │ Ask size   Price   Bid size│
│ MSFT 421.80   │ intratick updates via WS                      │    120     195.14          │
│ NVDA 903.22   │ volume bars below                              │     80     195.13          │
│ ... 500 syms  │ selected symbol focus                         │            195.12      140 │
│ last / chg /  │                                               │            195.11      220 │
│ vol / spread  │                                               │ Spread  Last  VWAP  Vol    │
├───────────────┼───────────────────────────────┬───────────────┼────────────────────────────┤
│ TIME & SALES  │ AGENT BLOTTER                │ RESEARCH/NEWS │ WHAT-IF TERMINAL            │
│ 10:35:01 100  │ Goldman BUY 100 AAPL 195.10  │ 10:34 Tech +  │ > Fed raises rates 50 bps  │
│ 10:35:01 200  │ mm-4 QUOTE ask 195.14        │ 10:35 AAPL... │ Drafted event card          │
│ 10:35:02 50   │ citadel SELL 50 MSFT 421.70  │ severity tags │ Queued for next tick        │
│ scrolling tape│ fills / cancels / status     │ symbol-linked │ aftermath + eventId         │
└───────────────┴───────────────────────────────┴───────────────┴────────────────────────────┘
```

UI direction: this should feel like a trading terminal, not a marketing dashboard.
- Dense information first: tables, tapes, ladders, and right-aligned numeric columns
- Chat is a side module, not the hero surface
- Use market-native color semantics: green bids, red asks, amber event/research alerts, neutral system chrome
- Monospace numbers for prices, sizes, and timestamps; compact row heights; sticky headers where appropriate
- Desktop-first terminal grid; mobile collapses into stacked priority panels instead of preserving the full matrix

---

## Packages to Install (POC only)

```bash
# LLM agents
bun add @mastra/core @mastra/anthropic @ai-sdk/anthropic ai

# Web scraping
bun add @mendable/firecrawl-js

# Broker + live data
bun add @alpacahq/alpaca-trade-api

# WebSocket server
bun add ws && bun add -D @types/ws

# Charts
bun add lightweight-charts recharts d3 @tanstack/react-virtual

# Chart typings
bun add -D @types/d3

# Logging
bun add pino

# Utilities
bun add nanoid decimal.js date-fns superjson eventemitter3

# Testing
bun add -D fast-check
```

Added `ai` + `@ai-sdk/anthropic` for streaming chat responses in the chatbot UI.

Not needed for POC: @polygon.io/client-js, @trigger.dev/sdk

---

## Build Steps (6 steps)

### Step 1: Schema + Types + Constants + Alpaca Seed
**Files**: `src/db/schema.ts`, `src/types/*`, `src/lib/constants.ts`, `src/alpaca/client.ts`, `src/alpaca/live-feed.ts`

- Replace `todos` schema with all 11 tables + enums
- Define all TypeScript interfaces
- Full S&P 500 ticker list in constants (symbol, name, sector, industry)
- Alpaca client configured for paper trading
- `live-feed.ts`: batch-fetch latest quotes + 60-day bars for all 500 tickers from Alpaca before tick 1
- Seed script: populate `symbols` table with 500 rows + real fundamentals
- Seed opening market state from Alpaca for the 500-symbol universe: quotes, recent bars, agent opening marks, and market-maker starting quotes
- Run `db:push` + seed

**Verify**: `bun run db:push` succeeds, 500 symbols exist in DB, and the bootstrap flow can load real market data from Alpaca for the full seed universe.

### Step 2: Dynamic Agent Factory + LOB Engine + Sim Loop
**Files**: `src/engine/*`, `src/agents/*`, `src/mastra/agents/trading-agent.ts`, `src/server/sim-runner.ts`

- `tradingAgent` Mastra template with RuntimeContext (single file, drives all 1000+ agents)
- `factory.ts`: generates 1070 agent configs from seeded distributions, assigns stable LLM groups, and spawns RuntimeContexts
- Round-robin batch system: 20 groups of 50, 1 group active per tick
- Active group makes LLM calls; inactive groups execute their last structured autopilot directive
- LimitOrderBook with market + limit orders, price-time FIFO
- MatchingEngine wrapping 500 LOBs
- EventBus for trade/lob/ohlcv events
- PortfolioManager for trade reconciliation
- `bootstrap.ts`: sync real S&P 500 from Alpaca → seed agents with positions + opening MM quotes
- SimOrchestrator tick loop (50 LLM calls/tick + 950 autopilot executions)
- `sim-runner.ts` — dedicated worker process with an awaited tick loop; optional minimum delay is pacing only
- DB batch write per tick (single transaction)

**Verify**:
- Start the worker and confirm tick `N+1` does not begin before tick `N` fully completes, even under slow LLM responses.
- Confirm the active batch produces LLM reasoning + fresh autopilot directives.
- Confirm inactive agents execute deterministic autopilot behavior without making LLM calls.
- Confirm matching is correct for FIFO, partial fills, and market orders walking the book.
- Target wall-clock performance remains in the low-single-digit seconds per tick under nominal conditions; treat LLM cost as an estimate, not a hard acceptance gate.

### Step 3: Dedicated Worker Runtime + WebSocket Transport
**Files**: `src/server/sim-runner.ts`, `src/server/ws/*`, app dev/runtime scripts

- Define the worker process lifecycle for the simulation and WS server
- Run the WS server on :3001 under worker ownership, not the browser or Vite request lifecycle
- ConnectionManager with channel subscriptions (per-symbol granularity)
- Broadcaster sends typed events after each tick (only to subscribed channels)
- Define the expected local-dev entrypoints for app + worker so the UI can consume worker-managed state

**Verify**:
- The worker can start, stop, and step the simulation independently of browser requests.
- WS payloads are emitted only after a completed tick commit.
- The app can reconnect to the worker-owned WS server without restarting the simulation.

### Step 4: Dashboard + Controls
**Files**: `src/hooks/*`, `src/components/*`, `src/routes/dashboard/*`

- React hooks: useSimWebSocket, useOrderBook, useMarketData, useSimControls, useAgentFeed
- Terminal-style top bar with selected symbol, session state, worker health, tick latency, and sim controls
- Watchlist panel for 500 symbols with last, change, volume, spread, and compact sparkline
- CandlestickChart (lightweight-charts, canvas, series.update on WS) with volume bars and event markers
- OrderBookDepth / ladder view with clear bid/ask separation and market stats
- Time & Sales tape for recent prints
- Agent blotter with fills, cancels, quotes, and reasoning snippets; virtualized for density
- Research/news feed with timestamp, severity, sentiment, and symbol linkage
- What-if chat panel styled as a command terminal with structured event cards and post-event reports
- Dense dashboard grid layout that feels like a real stock terminal, not a marketing dashboard
- SymbolSearch / symbol switcher that updates watchlist selection, chart, book, and tape together

**Verify**:
- Open browser, select AAPL, start sim, and see candles forming live.
- Switch to MSFT and confirm chart + order book subscriptions change cleanly.
- Pause and step controls reflect worker state rather than local UI-only state.
- Watchlist, tape, and blotter remain readable under continuous updates and large row counts.
- The chat panel behaves like an auxiliary trading tool, not the dominant page surface.

### Step 5: Research Agents + PublicationBus + Alpaca Paper Trade
**Files**: `src/mastra/agents/research-agent.ts`, `src/mastra/tools/firecrawlTool.ts`, `src/engine/bus/PublicationBus.ts`, `src/alpaca/orderBridge.ts`, `src/alpaca/hypothesisEngine.ts`, `src/agents/UserStrategyAgent.ts`

- `researchAgent` Mastra template: 15 instances with different RuntimeContexts (focus, sources)
- Firecrawl tool scrapes financial news → LLM analyses → PublicationBus.publish()
- PublicationBus with tier-based release delay (institutions get research first)
- Trading agents can reference released research in subsequent LLM turns
- hypothesisEngine: position limits, drawdown guards
- orderBridge: validated sim signals → Alpaca market/limit order API
- UserStrategyAgent: configurable strategy, runs inside sim as agent 1071
- Dashboard: Alpaca badge showing paper trade status + P&L

**Verify**:
- Research notes flow through the bus and appear in the UI.
- Trading agents can cite released research in their reasoning on later active turns.
- UserStrategyAgent can emit a validated signal and the Alpaca paper API can execute it.
- Treat aggregate LLM/research cost as an estimate, not a pass/fail requirement.

### Step 6: "What-If" Chatbot
**Files**: `src/mastra/agents/chatbot-agent.ts`, `src/mastra/tools/eventInjectionTool.ts`, `src/mastra/tools/simQueryTool.ts`, `src/mastra/prompts/chatbot.ts`, `src/components/dashboard/ChatPanel.tsx`, `src/routes/api/chat.ts`

- Chatbot Mastra agent with tools: eventInjection, simQuery, marketData, waitAndObserve
- Chatbot agent first turns natural language into a structured `WorldEventDraft`
- `eventInjectionTool`: accepts structured event args, validates them, enqueues an append-only `InjectWorldEventCommand` for the worker, and returns `eventId` + status
- `simQueryTool`: read-only queries for agent performance, prices, trades, and order book state
- `waitAndObserveTool`: takes `eventId` + ticks-to-wait, then reports post-event market and agent outcomes from worker-managed state
- ChatPanel: streaming chat UI in dashboard
- Server function at `/api/chat` streams Mastra responses as an app/API adapter; it never mutates live sim state directly
- Chat history can remain in-memory for the POC; persistent `chat_messages` storage is deferred unless it becomes required later

**Verify**:
- Type "What if Apple loses a $10B lawsuit?" → chatbot produces a `WorldEventDraft` → worker accepts queued command → event applies at the next tick boundary → price moves on the chart → chatbot reports aftermath after waiting the requested number of ticks.
- Type "Who's most profitable?" → get a data-driven answer from the DB.
- Confirm the chatbot reads worker-managed state rather than inventing outcomes client-side.
- Confirm invalid event requests are rejected without mutating worker state.

## Chatbot Interaction Examples

**Chatbot — "What-If" Event Simulator:**
The chatbot is a Mastra agent with a unique capability: it can inject world events into the running simulation and observe the consequences. This is the killer feature — you describe a scenario in natural language, and watch the market react.

Example interactions:
```
You: "What happens if the Fed raises rates by 0.5%?"
Bot: Injecting event: { type: 'rate_decision', magnitude: -0.03, title: 'Fed raises 50bps' }
     → Watch the candlestick chart — AAPL drops as agents react
     → Goldman reasoning: "Risk-off, reducing tech exposure..."
     → Market maker widens spread from $0.20 to $0.45
     After 10 ticks: "AAPL fell 1.8% from $195.12 to $191.60. Goldman sold 200 shares.
     Market maker spread widened 125%. Momentum agents triggered stop losses."

You: "What if Apple announces a $100B buyback?"
Bot: Injecting event: { type: 'news', magnitude: 0.05, affectedSymbols: ['AAPL'], title: 'AAPL $100B buyback' }
     → Value agents see increased fair value → buying pressure
     → After 10 ticks: "AAPL rose 2.3%. Value agents accumulated 45 shares."

You: "Who's the most profitable agent right now?"
Bot: Queries DB → "Goldman Sachs leads at +$3,240 (+0.65%). momentum-3 is second at +$890.
     noise-1 is worst at -$340. Market maker is flat (expected — they profit on spread)."

You: "Show me Goldman's last 5 decisions"
Bot: Queries orders table → returns Goldman's recent LLM reasoning + trade outcomes
```

Chatbot Mastra tools:
- `WorldEventDraft` — structured event intent produced by the chatbot agent before submission. Includes event type, title, affected symbols, magnitude, duration, and source metadata.
- `eventInjectionTool` — accepts structured `WorldEventDraft`-style args, validates them, assigns/returns `eventId`, and enqueues an append-only `InjectWorldEventCommand` for the worker. It does not parse natural language itself and does not mutate `SimOrchestrator` directly.
- `InjectWorldEventCommand` — worker-consumed command that is drained and applied at the next tick boundary.
- `simQueryTool` — queries DB: agent performance, recent trades, price history, order book state. Used for analytical questions.
- `marketDataTool` — (reused) reads live LOB snapshot
- `waitAndObserveTool` — takes `eventId` and waits N ticks before reporting what happened (price change, agent actions, volume spike) from persisted/post-tick results

Chat implementation:
- `src/routes/api/chat.ts` — server function that streams Mastra agent responses
- `src/components/dashboard/ChatPanel.tsx` — chat UI panel in dashboard (text input + message history + streaming response)
- Chat history persistence is intentionally deferred for the POC unless later requirements make it necessary

---

## Critical Files (in build order)

| Priority | File | Why it matters |
|---|---|---|
| 1 | `src/db/schema.ts` | Everything depends on the schema |
| 2 | `src/types/market.ts` | Order/Trade/LOB types used everywhere |
| 3 | `src/engine/lob/LimitOrderBook.ts` | The heart — if matching is wrong, nothing works |
| 4 | `src/engine/sim/SimOrchestrator.ts` | Coordinates every subsystem per tick |
| 5 | `src/agents/bootstrap.ts` | Without initial state, the market is dead |
| 6 | `src/server/ws/SimWebSocketServer.ts` | Bridge from engine to browser |
| 7 | `src/components/charts/CandlestickChart.tsx` | The visual payoff |
| 8 | `src/mastra/index.ts` | LLM agent brain |
| 9 | `src/mastra/agents/chatbot-agent.ts` | The "what-if" killer feature |
| 10 | `src/alpaca/live-feed.ts` | Real-world price grounding |

---

## Env Vars Needed

```env
# .env.local (add to existing)
DATABASE_URL=...                          # already exists
ANTHROPIC_API_KEY=sk-ant-...              # for Mastra LLM agents
FIRECRAWL_API_KEY=fc-...                  # for research agent
ALPACA_API_KEY=...                        # paper trading
ALPACA_API_SECRET=...                     # paper trading
ALPACA_BASE_URL=https://paper-api.alpaca.markets  # paper, not live
``
