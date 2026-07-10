# Finally — Finance Ally

> A stunning, AI-powered trading workstation. Bloomberg-terminal aesthetics, a live
> market data stream, a simulated trading portfolio, and an LLM co-pilot that can
> analyze positions and execute trades on your behalf.

**Status:** Planning · **Version:** 0.1.0 · **License:** MIT

---

## 1. Product Vision

Finally ("Finance Ally") is a self-contained trading terminal you run locally in a
single Docker container. It reproduces the *feel* of a professional trading desk —
dense dark UI, monospaced tickers, blinking price updates, multi-panel layout — but
it is a **simulation**: no real money, no real broker. Prices come from a built-in
market simulator; orders fill against that simulator; the portfolio lives in SQLite.

The differentiator is the **AI co-pilot**: a chat panel wired to an LLM (via
OpenRouter or Cerebras) that receives your live portfolio and market context, reasons
about it, and returns **structured output** — either analysis or concrete trade
instructions the backend validates and executes.

### Core capabilities

| Capability | Description |
|---|---|
| Live market data | Simulated tick stream (GBM price engine) pushed to the browser over **SSE**. |
| Simulated trading | Market/limit orders against the simulator; positions, cash, P&L tracked in SQLite. |
| AI co-pilot | LLM analyzes the portfolio and proposes/executes trades via **structured outputs**. |
| Persistence | SQLite on a mounted volume — portfolio & history survive restarts. |
| Single container | Frontend build is served by the backend; one image, one process. |

### Explicit non-goals (v1)

- No real brokerage / real-money integration.
- No multi-user auth (single-tenant local app; optional shared secret only).
- No horizontal scaling — deliberately a single process in a single container.
- No external market data vendor — the simulator is the source of truth.

---

## 2. Architecture Overview

Everything runs in **one process inside one container**. The backend is the spine: it
owns the market simulator, the database, the SSE stream, the REST API, and the AI
proxy. It also serves the compiled frontend as static files. There is no second
service, no message broker, no separate database container.

```
┌──────────────────────────── Docker container (one process) ───────────────────────────┐
│                                                                                          │
│   ┌───────────────────────────────  Node.js / Fastify  ──────────────────────────────┐  │
│   │                                                                                   │  │
│   │   Static file server ──────────►  serves /web/dist (compiled React SPA)           │  │
│   │                                                                                   │  │
│   │   REST API  (/api/*)                                                              │  │
│   │     ├─ /api/portfolio        read positions, cash, P&L                            │  │
│   │     ├─ /api/orders           place / list orders                                  │  │
│   │     ├─ /api/quotes           snapshot of current prices                           │  │
│   │     └─ /api/ai/chat          co-pilot turn (LLM structured output)                │  │
│   │                                                                                   │  │
│   │   SSE stream  (/api/stream)  ──►  pushes quote ticks + fills + portfolio deltas   │  │
│   │                                                                                   │  │
│   │   ┌─────────────┐   ┌──────────────┐   ┌───────────────┐   ┌────────────────────┐ │  │
│   │   │ Market Sim  │   │ Order/Match  │   │  AI Service   │   │  SQLite (better-   │ │  │
│   │   │ (GBM ticks) │──►│  Engine      │──►│ (OpenRouter/  │   │  sqlite3, WAL)     │ │  │
│   │   │  setInterval│   │              │   │  Cerebras)    │   │  on mounted volume │ │  │
│   │   └─────────────┘   └──────────────┘   └───────────────┘   └────────────────────┘ │  │
│   │           │                 │                  │                     ▲             │  │
│   │           └─────────────────┴──────────────────┴─────────────────────┘            │  │
│   │                        in-process function calls, one event bus                    │  │
│   └───────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
│   Volume mount:  /data/finally.db   (SQLite database file — persists across restarts)    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
              ▲                                              │
              │ HTTP (REST + SSE)                            │ HTTPS (outbound only)
              ▼                                              ▼
      ┌───────────────┐                            ┌────────────────────────┐
      │  Browser SPA  │                            │  OpenRouter / Cerebras │
      │ React + Vite  │                            │      LLM API           │
      └───────────────┘                            └────────────────────────┘
```

### Why this shape

- **Single container = single Node process.** The frontend is a static build; Fastify
  serves it. No nginx, no reverse proxy, no second runtime.
- **In-process event bus.** The simulator, matching engine, and SSE broadcaster talk
  through a plain Node `EventEmitter`. No Redis, no queue.
- **SQLite over the network DBs.** `better-sqlite3` is synchronous and embedded —
  zero connection management, and WAL mode gives us safe concurrent reads while the
  writer commits. The DB file lives on a mounted volume so it survives `docker rm`.
- **SSE over WebSockets.** Market data is one-directional server→client. SSE is
  simpler (plain HTTP, auto-reconnect built into `EventSource`), survives proxies, and
  needs no extra protocol. Client→server actions (orders, chat) go over normal REST.

---

## 3. Technology Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Node.js 20+** (LTS) | Single language across the stack; excellent SSE + fetch. |
| Backend framework | **Fastify** | Fast, low overhead, first-class TypeScript, built-in schema validation. |
| Language | **TypeScript** (strict) | Shared types between backend and frontend. |
| Database | **SQLite** via `better-sqlite3` | Embedded, synchronous, WAL; no DB server. |
| Migrations | Hand-rolled SQL runner (or `drizzle-kit`) | Deterministic schema on boot. |
| Frontend | **React 18 + Vite** | Fast dev/build; SPA served statically. |
| Styling | **Tailwind CSS** + CSS variables | Rapid, consistent "terminal" design system. |
| Charts | **lightweight-charts** (TradingView) | Canvas candlestick/line charts; the Bloomberg look. |
| State/data | **TanStack Query** + `EventSource` | REST caching + live SSE merge. |
| Validation | **Zod** | One schema source for API bodies *and* LLM structured output. |
| AI transport | **OpenRouter** or **Cerebras** REST | OpenAI-compatible; structured outputs via JSON Schema / tool calls. |
| Container | **Multi-stage Docker** | Build web + server, ship one slim runtime image. |

> **Alternative considered:** a Python/FastAPI backend. Rejected for v1 to keep a
> single language (TypeScript) shared end-to-end, which lets us reuse Zod schemas for
> both request validation and LLM structured output. The architecture is otherwise
> identical and could be ported.

---

## 4. Directory Structure

A monorepo with two workspaces (`server`, `web`) and shared types. The Docker build
compiles `web` into static assets that `server` serves.

```
finally/
├── planning/
│   └── plan.md                  # this document
├── README.md                    # quickstart
├── LICENSE
├── .env.example                 # documented environment variables
├── .dockerignore
├── .gitignore
├── Dockerfile                   # multi-stage: build web + server → single runtime
├── docker-compose.yml           # convenience: volume + env wiring for local run
├── package.json                 # root: workspaces + top-level scripts
├── tsconfig.base.json           # shared TS config
│
├── shared/                      # types & schemas imported by BOTH server and web
│   ├── package.json
│   └── src/
│       ├── types.ts             # Quote, Order, Position, Portfolio, Fill, ChatMessage
│       ├── ai-schema.ts         # Zod schemas for LLM structured output (the contract)
│       └── constants.ts         # instrument universe, tick interval, fees
│
├── server/                      # backend (the only runtime process)
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts             # bootstrap: Fastify, static serving, graceful shutdown
│       ├── config.ts            # env parsing + validation (fail fast on bad config)
│       ├── bus.ts               # in-process EventEmitter (ticks, fills, deltas)
│       │
│       ├── db/
│       │   ├── connection.ts    # better-sqlite3 init, WAL pragma, path from env
│       │   ├── migrate.ts       # runs SQL migrations on boot
│       │   └── migrations/
│       │       └── 001_init.sql # schema: instruments, positions, orders, fills, cash
│       │
│       ├── market/
│       │   ├── simulator.ts     # GBM price engine; emits ticks on interval
│       │   └── universe.ts      # seed instruments (symbols, start prices, vol)
│       │
│       ├── trading/
│       │   ├── engine.ts        # order validation, matching/fill, position + cash update
│       │   └── portfolio.ts     # compute positions, market value, realized/unrealized P&L
│       │
│       ├── ai/
│       │   ├── client.ts        # OpenRouter/Cerebras HTTP client (OpenAI-compatible)
│       │   ├── copilot.ts       # builds context, calls LLM, parses structured output
│       │   ├── tools.ts         # tool/function definitions (analyze, place_order)
│       │   └── prompts.ts       # system prompt + guardrails
│       │
│       ├── routes/
│       │   ├── portfolio.ts     # GET /api/portfolio
│       │   ├── orders.ts        # POST /api/orders, GET /api/orders
│       │   ├── quotes.ts        # GET /api/quotes
│       │   ├── stream.ts        # GET /api/stream  (SSE)
│       │   └── ai.ts            # POST /api/ai/chat
│       │
│       └── sse/
│           └── broker.ts        # tracks SSE clients, fan-out from the event bus
│
└── web/                         # frontend SPA (compiled to static, served by server)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts           # dev proxy → server; build → web/dist
    ├── tailwind.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx              # terminal grid layout
        ├── theme.css            # design tokens: colors, mono font, grid, glow
        ├── lib/
        │   ├── api.ts           # typed REST client (imports shared types)
        │   └── stream.ts        # EventSource wrapper → React state
        ├── hooks/
        │   ├── useStream.ts     # subscribe to /api/stream
        │   ├── usePortfolio.ts  # TanStack Query + live deltas
        │   └── useQuotes.ts
        └── components/
            ├── Watchlist.tsx    # live ticker grid (blink on change)
            ├── Chart.tsx        # lightweight-charts price panel
            ├── OrderTicket.tsx  # buy/sell form → POST /api/orders
            ├── Positions.tsx    # holdings + P&L table
            ├── Blotter.tsx      # order/fill history
            ├── CoPilot.tsx      # AI chat panel; renders analysis + trade proposals
            └── StatusBar.tsx    # clock, connection state, latency
```

---

## 5. Boundaries: Frontend · Backend · AI

Clear seams keep the app simple and testable. Each layer has one job and a narrow
contract with its neighbors.

### 5.1 Frontend (web/) — *presentation & intent only*

- **Owns:** rendering, layout, local UI state, the SSE subscription, and user intent
  (clicking Buy, typing to the co-pilot).
- **Does NOT own:** price generation, order matching, P&L math, or AI keys. It never
  talks to the LLM directly — the API key stays server-side.
- **Talks to backend via:** typed REST (`web/src/lib/api.ts`) + one SSE connection
  (`web/src/lib/stream.ts`). All shapes come from `shared/`.
- **Rule:** the frontend is a thin client. If it computes P&L, that's for *display
  smoothing* only; the backend value is authoritative.

### 5.2 Backend (server/) — *source of truth*

- **Owns:** the market simulator, order/matching engine, portfolio & cash accounting,
  the database, the SSE fan-out, and the AI proxy.
- **Contract in:** REST bodies validated with Zod; rejects malformed orders.
- **Contract out:** JSON REST responses + SSE events, all typed from `shared/`.
- **Rule:** every state mutation (fill, cash change) is persisted to SQLite *and* then
  broadcast on the event bus so SSE clients converge. The DB is the ledger; SSE is a
  notification, never the record.

### 5.3 AI (server/ai/) — *advisor with a validated hand on the controls*

- **Owns:** prompt construction, the LLM HTTP call, and parsing/validating structured
  output. It is a module inside the backend, not a separate service.
- **Input:** a compact snapshot — current quotes, positions, cash, recent fills, and
  the user's message.
- **Output:** **structured** (JSON Schema / tool call), one of:
  - `analysis` — narrative + key metrics, no side effects; or
  - `place_order` — a concrete order the engine **re-validates** exactly like a
    human-submitted order before it can fill.
- **Guardrail:** the LLM never touches SQLite or the engine directly. It *returns a
  proposal*; `trading/engine.ts` is the only code that can move money. Depending on
  `AI_TRADE_MODE`, a proposed order is either auto-executed or held for one-click
  human confirmation in the UI.

```
User ──chat──► /api/ai/chat ──► copilot.ts
                                   │  build context (portfolio + quotes)
                                   ▼
                              LLM (OpenRouter/Cerebras)
                                   │  structured output (Zod-validated)
                        ┌──────────┴───────────┐
                        ▼                      ▼
                   analysis                place_order
                (return to UI)      engine.validate() ──► fill ──► DB ──► SSE
```

---

## 6. Data Model (SQLite)

WAL mode; the file path comes from `DATABASE_PATH` (default `/data/finally.db`).
Schema is created idempotently by `db/migrate.ts` on boot and seeded on first run.

```sql
-- 001_init.sql

CREATE TABLE IF NOT EXISTS instruments (
  symbol      TEXT PRIMARY KEY,          -- e.g. 'AAPL'
  name        TEXT NOT NULL,
  start_price REAL NOT NULL,
  volatility  REAL NOT NULL,             -- annualized, drives the GBM step
  created_at  INTEGER NOT NULL           -- epoch ms
);

CREATE TABLE IF NOT EXISTS account (
  id         INTEGER PRIMARY KEY CHECK (id = 1),  -- single account row
  cash       REAL NOT NULL,                        -- available buying power
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  symbol      TEXT PRIMARY KEY REFERENCES instruments(symbol),
  quantity    REAL NOT NULL,             -- signed; negative = short
  avg_price   REAL NOT NULL,             -- cost basis
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,          -- uuid
  symbol      TEXT NOT NULL REFERENCES instruments(symbol),
  side        TEXT NOT NULL CHECK (side IN ('buy','sell')),
  type        TEXT NOT NULL CHECK (type IN ('market','limit')),
  quantity    REAL NOT NULL,
  limit_price REAL,                       -- null for market orders
  status      TEXT NOT NULL CHECK (status IN ('pending','filled','rejected','cancelled')),
  source      TEXT NOT NULL CHECK (source IN ('human','ai')),
  reason      TEXT,                       -- AI rationale, if source='ai'
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fills (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id),
  symbol     TEXT NOT NULL,
  side       TEXT NOT NULL,
  quantity   REAL NOT NULL,
  price      REAL NOT NULL,              -- execution price
  fee        REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         TEXT PRIMARY KEY,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content    TEXT NOT NULL,             -- text; assistant may embed proposal json
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fills_created  ON fills(created_at DESC);
```

**Seed on first run:** ~8–12 instruments (e.g. AAPL, MSFT, NVDA, TSLA, AMZN, GOOGL,
SPY, BTC-USD) with plausible start prices and vols, an `account` row with a starting
cash balance (`STARTING_CASH`, default 100,000), and empty positions.

**Note on live prices:** current prices are *not* stored per tick (that would bloat
the DB). The simulator holds the live price in memory and streams it. Only durable
facts — orders, fills, positions, cash — are persisted.

---

## 7. Market Simulator

A deterministic-ish price engine that feels like a live market.

- **Model:** Geometric Brownian Motion per instrument. Each tick:
  `price *= exp((−0.5σ²)dt + σ√dt · Z)` where `Z ~ N(0,1)`, `σ` from the instrument,
  `dt = TICK_INTERVAL_MS / 1yr`.
- **Cadence:** one `setInterval` at `TICK_INTERVAL_MS` (default 1000 ms) updates all
  symbols, then emits a `quote` event on the bus.
- **OHLC:** the engine keeps a rolling in-memory candle buffer per symbol (e.g. last
  300 candles) so the chart has history immediately on connect; new candles are
  emitted on the stream.
- **Determinism (optional):** seed the RNG from `MARKET_SEED` for reproducible demos.
- **Market hours:** always "open" by default; optional `MARKET_ALWAYS_OPEN=false`
  freezes ticks outside a configurable window.

The simulator is the single source of price truth. The matching engine reads the
current in-memory price to fill market orders and to mark positions.

---

## 8. Trading Engine

- **Order intake:** `POST /api/orders` (human) and AI proposals both funnel into
  `engine.submitOrder()`. Same validation path — no privileged path for the AI.
- **Validation:** symbol exists; quantity > 0; sufficient cash for buys (incl. fee);
  sufficient position for sells (or allow shorting if `ALLOW_SHORTING=true`); limit
  price sane.
- **Matching:**
  - *Market order* → fills immediately at the current simulated price (+ optional
    slippage/fee).
  - *Limit order* → fills when the simulated price crosses `limit_price`; otherwise
    stays `pending` and is checked on each tick.
- **Settlement (atomic, one SQLite transaction):** write `fill`, update `positions`
  (recompute `avg_price` / realized P&L), update `account.cash`, set order `status`.
- **Broadcast:** after commit, emit `fill` + `portfolio` deltas on the bus → SSE.
- **P&L:** `portfolio.ts` computes unrealized P&L = `(mark − avg_price) × qty` using
  the live mark; realized P&L accumulates from closing fills.

---

## 9. Server-Sent Events (SSE)

One SSE endpoint multiplexes all live data. `sse/broker.ts` keeps the set of connected
responses and fans out bus events.

- **Endpoint:** `GET /api/stream`
- **Event types** (`event:` field):
  - `quote` — `{ symbol, price, ts }` (or a batched array per tick)
  - `candle` — `{ symbol, o,h,l,c, ts }` on candle close
  - `fill` — `{ orderId, symbol, side, qty, price, ts }`
  - `portfolio` — `{ cash, positions[], equity, pnl }` snapshot/delta
  - `heartbeat` — comment ping every ~15 s to keep intermediaries from closing idle connections
- **Client:** `EventSource('/api/stream')` with automatic reconnection; the frontend
  merges quotes into the watchlist/chart and portfolio deltas into TanStack Query cache.
- **Backpressure:** quotes are coalesced to the latest per symbol per tick; the stream
  is fire-and-forget (SSE has no client ack), which is fine because the DB is the record.

---

## 10. AI Co-Pilot (Structured Outputs)

### 10.1 Transport

OpenAI-compatible Chat Completions against **OpenRouter** or **Cerebras**, selected by
`AI_PROVIDER`. Both accept `response_format` / tool calls for structured output.

- OpenRouter base URL: `https://openrouter.ai/api/v1`
- Cerebras base URL: `https://api.cerebras.ai/v1`
- Model chosen via `AI_MODEL` (e.g. an OpenRouter model slug, or a Cerebras model like
  `llama-3.3-70b`). Cerebras is favored for very low latency; OpenRouter for model
  breadth.

### 10.2 The structured contract

The LLM must return JSON conforming to a schema we own in `shared/ai-schema.ts` (Zod →
JSON Schema). Two response variants via a discriminated union:

```ts
// shared/ai-schema.ts (illustrative)
const Analysis = z.object({
  kind: z.literal('analysis'),
  summary: z.string(),
  observations: z.array(z.string()),
  risk_flags: z.array(z.string()).default([]),
});

const OrderProposal = z.object({
  kind: z.literal('order_proposal'),
  rationale: z.string(),
  orders: z.array(z.object({
    symbol: z.string(),
    side: z.enum(['buy', 'sell']),
    type: z.enum(['market', 'limit']),
    quantity: z.number().positive(),
    limit_price: z.number().positive().optional(),
  })).min(1),
});

export const CoPilotResponse = z.discriminatedUnion('kind', [Analysis, OrderProposal]);
```

- We send this schema as the response format (structured output). On return we
  **validate with Zod**; if it fails, we retry once with the error, then surface a
  graceful "couldn't parse" message. The model output is *never* trusted raw.

### 10.3 Turn flow

1. `POST /api/ai/chat { message }`.
2. `copilot.ts` assembles context: current quotes for held + watched symbols,
   positions, cash, equity, recent fills, and the last N chat turns.
3. Call the LLM with the system prompt (guardrails: simulation only, respect cash,
   explain risk) + context + user message, requesting structured output.
4. Validate the response with Zod.
5. If `analysis` → persist assistant message, return to UI.
6. If `order_proposal` → for each order run `engine.validate()`:
   - `AI_TRADE_MODE=auto` → execute immediately, return fills.
   - `AI_TRADE_MODE=confirm` (default) → return the validated proposal to the UI for a
     one-click **Confirm** that re-POSTs to `/api/orders` with `source='ai'`.
7. Any resulting fills flow through the normal engine → DB → SSE path, so the whole UI
   updates live.

### 10.4 Safety rails

- **The LLM cannot execute directly.** It only proposes; the engine is the sole
  mutator, and it re-validates every proposal (cash, symbol, size caps).
- **Position/notional caps:** `AI_MAX_ORDER_NOTIONAL` bounds any single AI order.
- **Default to confirm mode** so a human approves trades until explicitly set to auto.
- **No secrets to the client:** the API key lives only in `server/`; the browser calls
  our `/api/ai/chat`, never the LLM.

---

## 11. HTTP API Summary

| Method | Path | Purpose | Body / Notes |
|---|---|---|---|
| GET | `/api/health` | Liveness | `{ ok: true }` |
| GET | `/api/quotes` | Snapshot of all current prices | `Quote[]` |
| GET | `/api/instruments` | Instrument universe | `Instrument[]` |
| GET | `/api/portfolio` | Cash, positions, equity, P&L | `Portfolio` |
| GET | `/api/orders` | Order + fill history | query: `limit`, `status` |
| POST | `/api/orders` | Place an order | `{ symbol, side, type, quantity, limit_price? }` |
| POST | `/api/ai/chat` | Co-pilot turn | `{ message }` → `CoPilotResponse` |
| GET | `/api/stream` | **SSE** live feed | events: quote, candle, fill, portfolio, heartbeat |
| GET | `/*` | SPA (static) | serves `web/dist/index.html` (client routing) |

All request/response shapes are defined once in `shared/` and imported by both sides.

---

## 12. Environment Variables

Documented in `.env.example`; parsed and validated at boot by `server/src/config.ts`
(the process **fails fast** if required vars are missing or malformed).

```dotenv
# ── Server ─────────────────────────────────────────────
PORT=8080                       # HTTP port the container listens on
NODE_ENV=production
LOG_LEVEL=info                  # fatal|error|warn|info|debug|trace

# ── Database ───────────────────────────────────────────
DATABASE_PATH=/data/finally.db  # SQLite file on the mounted volume (persists)

# ── Market simulator ───────────────────────────────────
TICK_INTERVAL_MS=1000           # price update cadence
MARKET_SEED=                    # optional RNG seed for reproducible demos
MARKET_ALWAYS_OPEN=true         # false → ticks pause outside market hours
STARTING_CASH=100000            # seed cash on first run
ALLOW_SHORTING=false            # permit negative positions

# ── AI co-pilot ────────────────────────────────────────
AI_PROVIDER=openrouter          # openrouter | cerebras
AI_API_KEY=                     # REQUIRED — provider key (server-side only)
AI_MODEL=meta-llama/llama-3.3-70b-instruct   # provider-specific model id
AI_BASE_URL=                    # optional override of provider base URL
AI_TRADE_MODE=confirm           # confirm | auto  — human-in-the-loop by default
AI_MAX_ORDER_NOTIONAL=25000     # cap per AI-proposed order
AI_REQUEST_TIMEOUT_MS=30000

# ── Optional access control ────────────────────────────
APP_SHARED_SECRET=              # if set, required as a header/cookie to use the app
```

**Secrets never reach the browser.** `AI_API_KEY` and `APP_SHARED_SECRET` are read only
in `server/`. The frontend receives a minimal, safe `/api/config` (feature flags, trade
mode) if needed — never keys.

---

## 13. Containerization (Single Container)

One multi-stage `Dockerfile`. Stage 1 builds the frontend and compiles the server;
the final stage ships a slim Node runtime with the built server + `web/dist` and the
native `better-sqlite3` binary. **One image, one process, one port.**

```dockerfile
# ---- Stage 1: build ----
FROM node:20-slim AS build
WORKDIR /app
# install workspace deps (root + shared + server + web)
COPY package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
# copy sources and build
COPY . .
RUN npm run build          # builds shared, web (→ web/dist), server (→ server/dist)

# ---- Stage 2: runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# production deps only (better-sqlite3 native module included)
COPY package.json ./
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --omit=dev --workspace server --workspace shared
# built artifacts
COPY --from=build /app/server/dist   server/dist
COPY --from=build /app/shared/dist   shared/dist
COPY --from=build /app/web/dist      web/dist
# data dir for the SQLite volume
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
```

`docker-compose.yml` (developer convenience — still a single service):

```yaml
services:
  finally:
    build: .
    ports:
      - "8080:8080"
    env_file: .env
    volumes:
      - finally-data:/data          # SQLite persists here across restarts
volumes:
  finally-data:
```

Run:

```bash
cp .env.example .env      # then set AI_API_KEY
docker compose up --build
# open http://localhost:8080
```

Persistence check: place a trade, `docker compose down`, `docker compose up` — the
portfolio is still there because `/data/finally.db` lives on the named volume.

---

## 14. UI / Design Language (the "Bloomberg" feel)

- **Palette:** near-black background (`#0a0e14`), panel `#111722`, hairline borders,
  amber/green/red accents; up = green, down = red, with a brief **flash** on change.
- **Type:** monospaced for all numerics (`JetBrains Mono` / `IBM Plex Mono`); tight,
  dense rows.
- **Layout:** a CSS grid of panels — Watchlist (left), Chart (center), Order Ticket +
  Positions (right), Blotter (bottom), Co-Pilot (docked right or bottom), Status Bar
  (footer with clock, connection state, tick latency).
- **Live cues:** blinking last-price cells, a pulsing "LIVE" indicator tied to SSE
  connection state, animated P&L.
- **Co-Pilot panel:** chat transcript; assistant analysis rendered as cards; order
  proposals rendered as an actionable ticket with **Confirm / Dismiss** (in confirm
  mode).
- **Accessibility:** color is never the only signal (arrows/labels too); keyboard
  shortcuts for buy/sell focus.

---

## 15. Implementation Plan (Step-by-Step)

Milestones are ordered so the app is runnable early and each step adds a visible slice.

### Phase 0 — Scaffold (foundations)
1. Init repo: root `package.json` with npm workspaces (`shared`, `server`, `web`),
   `tsconfig.base.json`, `.gitignore`, `.dockerignore`, `.env.example`, `LICENSE`.
2. Create `shared/` with `types.ts`, `constants.ts`, and a stub `ai-schema.ts`.
3. Stand up Fastify in `server/index.ts` with `/api/health`; add `config.ts` env
   parsing (fail fast).
4. Scaffold Vite + React + Tailwind in `web/`; blank terminal shell + Status Bar.
5. Wire Vite dev proxy `/api → localhost:PORT`; confirm hot reload + health call.

### Phase 1 — Database & persistence
6. `db/connection.ts` (better-sqlite3, WAL, path from env) + `migrate.ts` runner.
7. `migrations/001_init.sql` schema; seed instruments + `account` on first run.
8. `portfolio.ts` read model (positions, cash, equity, P&L) + `GET /api/portfolio`.
9. Verify persistence: write a row, restart, read it back.

### Phase 2 — Market simulator & SSE
10. `market/universe.ts` seed + `market/simulator.ts` GBM engine on `setInterval`.
11. In-memory candle buffers; `GET /api/quotes` + `GET /api/instruments`.
12. `bus.ts` EventEmitter; `sse/broker.ts`; `GET /api/stream` emitting `quote`/`candle`
    + heartbeats.
13. Frontend `stream.ts` (`EventSource`) + `useStream` + `Watchlist` with flashing
    prices; `Chart.tsx` with lightweight-charts fed by candles.

### Phase 3 — Trading
14. `trading/engine.ts`: validate → match (market now, limit on tick) → settle in one
    SQLite transaction → broadcast `fill` + `portfolio`.
15. `POST /api/orders` + `GET /api/orders`; `OrderTicket`, `Positions`, `Blotter`
    components; live P&L via SSE `portfolio` deltas.
16. Edge cases: insufficient funds, invalid symbol, limit fills, fees; (optional)
    shorting behind `ALLOW_SHORTING`.

### Phase 4 — AI co-pilot
17. Finalize `shared/ai-schema.ts` (discriminated union) → JSON Schema.
18. `ai/client.ts` (OpenRouter/Cerebras, OpenAI-compatible) + `ai/prompts.ts` +
    `ai/tools.ts`.
19. `ai/copilot.ts`: build context, call LLM with structured output, Zod-validate,
    retry-once on parse failure.
20. `POST /api/ai/chat`; route `analysis` vs `order_proposal`; enforce
    `AI_TRADE_MODE`, `AI_MAX_ORDER_NOTIONAL`; proposals re-validated by the engine.
21. `CoPilot.tsx`: chat UI, analysis cards, actionable proposals with Confirm/Dismiss.

### Phase 5 — Polish & harden
22. Design pass: palette, mono type, panel grid, flashes, LIVE indicator, animations.
23. Robustness: SSE reconnect UX, LLM timeout/error handling, optional
    `APP_SHARED_SECRET` gate, input validation everywhere.
24. Tests: engine unit tests (fills, P&L), schema validation tests, a smoke e2e
    (place order → see fill over SSE).

### Phase 6 — Containerize & ship
25. Multi-stage `Dockerfile` + `docker-compose.yml` with the `/data` volume.
26. `README.md` quickstart; verify persistence across `down`/`up`; healthcheck green.
27. Tag `v0.1.0`.

### Suggested milestones
- **M1 (Phases 0–2):** live terminal — streaming prices, chart, watchlist. *Demoable.*
- **M2 (Phase 3):** you can trade; portfolio & P&L update live.
- **M3 (Phase 4):** AI co-pilot analyzes and proposes/executes trades.
- **M4 (Phases 5–6):** polished, hardened, single-container image.

---

## 16. Testing & Verification

- **Unit:** matching engine (market/limit fills, avg price, realized/unrealized P&L),
  cash accounting, Zod schema round-trips.
- **Integration:** `POST /api/orders` → fill persisted → `portfolio` reflects it →
  SSE `fill` observed by a test client.
- **AI:** mock the LLM HTTP call; assert structured output is validated and that a
  malformed response triggers the retry-then-graceful path; assert the engine rejects
  an over-notional AI proposal.
- **Persistence:** trade, restart container, assert state survives on the volume.
- **Manual smoke:** open UI, watch prices flash, place a trade, ask the co-pilot to
  "rebalance toward tech," confirm the proposed order.

---

## 17. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LLM returns invalid/unsafe JSON | Zod validation + one retry + graceful fallback; engine re-validates every order. |
| AI places a reckless trade | `confirm` mode by default; `AI_MAX_ORDER_NOTIONAL`; engine caps. |
| SSE dropped by proxies/idle | Heartbeat comments; `EventSource` auto-reconnect; DB is source of truth. |
| SQLite write contention | WAL mode; all mutations in short transactions; single writer (one process). |
| `better-sqlite3` native build in Docker | Build in-image on `node:20-slim`; pin versions; ship the compiled module. |
| Secret leakage to client | Keys only in `server/`; browser never sees provider creds. |
| Simulated prices feel fake | GBM with per-instrument vol + occasional jumps; seeded runs for demos. |

---

## 18. Future Extensions (post-v1)

- Multiple watchlists / instrument search; options or crypto pairs.
- Strategy backtesting against the simulator's history buffer.
- Multi-account / auth; per-user portfolios.
- Streaming AI responses (token-by-token) into the co-pilot panel.
- Alerts (price/P&L thresholds) surfaced over the same SSE channel.
- Export/import portfolio; downloadable trade history (CSV).

---

## 19. Independent Review — Questions, Feedback & Simplifications

> Added by an **independent architecture review** (via the `/docreview` command,
> 2026-07-10). The reviewer read this plan cold plus the M1 code and was asked to
> find weaknesses, not to praise. Section references point back into this document.
> **These are open items for the author to adjudicate — not yet decisions.**

### Clarifying Questions

1. **Money representation.** Cash, `avg_price`, `quantity`, and fill `price` are all
   SQLite `REAL` (float64) (§6). Over many fills, average-cost recomputation and cash
   deduction accumulate binary-float drift — cash can land at `99999.99999997` or drift
   slightly negative. Store money as integer minor units (cents), or commit to a fixed
   rounding discipline with an epsilon on the "sufficient cash" check? Decide before M2.
2. **Price state on restart.** §6 deliberately does not persist per-tick prices; the
   simulator re-seeds from `instruments.start_price` on boot. Every restart snaps all
   marks back to seed, causing a discontinuous jump in equity/unrealized P&L, and any
   `pending` limit order is re-evaluated against reset prices. Persist last-price-per-
   symbol (one cheap upsert row per symbol) so restarts resume near where they left off?
3. **Pending limit-order lifetime.** Limit orders rest as `pending` and are swept every
   tick (§8). No time-in-force or expiry → the pending set grows unbounded and survives
   restarts (see Q2). Are limit orders GTC or day orders, and what is restart semantics —
   cancel-on-boot, or resume?
4. **Notional cap scope.** `AI_MAX_ORDER_NOTIONAL` "bounds any single AI order" (§10.4),
   but `OrderProposalSchema.orders` is `.min(1)` with **no max** — the model can propose
   many orders each just under the cap, or many turns in a row. Is the cap per-order,
   per-proposal aggregate, or per-session? Is notional recomputed at execution time (in
   `confirm` mode the price moves between proposal and confirm)?
5. **Fee & slippage model.** §8 says "optional slippage/fee" and `fills` has a `fee`
   column, but no model is specified. Flat per-trade, bps of notional, or none for v1?
   This changes cash math and every engine unit test.
6. **P&L accounting method.** §8 implies average-cost. Is that final (vs FIFO tax lots)?
   State it explicitly; it drives realized-P&L test expectations.
7. **Shorting semantics.** `ALLOW_SHORTING` exists but with no margin/buying-power model:
   what is buying power for a short, how are a short's cost basis and unrealized P&L
   signed, and is there any margin-call/liquidation? If undefined, should v1 simply
   forbid shorting to remove an entire branch?
8. **Reset / liquidation.** There is no endpoint to reset the simulation (flatten
   positions, restore `STARTING_CASH`). For repeated demos this is needed — in scope for
   v1? What happens if cash goes negative?
9. **Access-control reach.** `APP_SHARED_SECRET` is optional and currently unenforced. If
   the container is exposed beyond localhost, does the secret gate **all** `/api/*`
   including `/api/stream` and the cost-bearing `/api/ai/chat`? Note `EventSource` cannot
   send an `Authorization` header — for SSE the secret must be a cookie or query param.
   Which?

### Architecture & Correctness Feedback

- **Graceful shutdown does not yet stop the market loop.** `index.ts` closes Fastify then
  the DB, but there is no `clearInterval` for the (not-yet-added) tick timer. When the
  simulator lands, an in-flight tick can call into a closing DB and throw during
  shutdown. Also, `process.exit(0)` in `finally` always exits 0 even if `app.close()`/
  `db.close()` throws, masking shutdown failures. *Mitigation:* register the interval
  handle and `clearInterval` first in `shutdown`; exit non-zero on shutdown error; add
  `unhandledRejection`/`uncaughtException` handlers (one bad LLM/tick rejection currently
  takes down the whole process — the single-container blast radius).
- **Float-safe cash guard.** Beyond Q1, the "sufficient cash for buys (incl. fee)" check
  (§8) must tolerate float error or it will spuriously reject exact-balance orders (and
  spuriously allow tiny overdrafts). *Mitigation:* cents-as-integer, or compare with an
  epsilon and round the stored result.
- **Liveness ≠ ticking.** The `HEALTHCHECK` only proves HTTP is up; a market whose
  `setInterval` died would still report healthy. *Mitigation:* have `/api/health` return
  `lastTickAt`/tick age and connected-client count, and fail if ticks are stale.
- **WAL growth.** Long-running WAL with steady writes needs periodic checkpointing or the
  `-wal` file grows. *Mitigation:* rely on default auto-checkpoint but verify under load;
  consider a periodic `wal_checkpoint(TRUNCATE)`.

### AI Co-Pilot & Security Concerns

- **No rate limiting on the one endpoint that costs real money.** `/api/ai/chat` spends
  provider tokens per call, and with `APP_SHARED_SECRET` optional/unenforced it is open on
  whatever host the container is exposed on. *Mitigation:* require the shared secret
  whenever AI is enabled; add a per-IP/per-session request cap and a max-tokens ceiling;
  consider a daily spend/request budget that fails closed.
- **Prompt injection via chat.** User chat text and (later) any instrument metadata flow
  into the LLM prompt. A user could try to talk the co-pilot past its caps. *Mitigation:*
  the engine re-validates every proposal regardless of what the model "decided" (already
  the design in §10.4) — keep that invariant ironclad and never let the model's text
  bypass `engine.validate()`.
- **Key-leak surfaces in logs.** Ensure the AI client never logs request headers (Bearer
  key) or full upstream error bodies at `info`. A verbose fetch wrapper + Fastify logger
  is the usual place a key ends up in a log line.
- **Provider structured-output portability.** Not every model/provider honors JSON-Schema
  `response_format` identically; a discriminated union is the least-supported shape on the
  wire. *Mitigation:* prefer tool/function-calling or a flat schema (see Simplify), and
  keep the Zod validate-then-retry as the real guarantee.

### SSE & Real-Time Concerns

- **No replay / Last-Event-ID.** On reconnect, `EventSource` re-opens but the server has no
  event log, so events emitted during the gap are lost. For quotes that is fine (next tick
  corrects the price), but a missed `fill`/`portfolio` delta leaves the UI stale.
  *Mitigation:* on (re)connect, send a full `snapshot` event (portfolio + current quotes)
  so the client always resyncs to truth; treat deltas as best-effort.
- **Browser 6-connection limit & proxy buffering.** One SSE connection per tab; multiple
  tabs plus HTTP/1.1's ~6-per-origin cap can starve REST calls, and some proxies buffer
  `text/event-stream`. *Mitigation:* document single-tab expectation for v1; set
  `Cache-Control: no-cache`, `X-Accel-Buffering: no`, and flush headers immediately.
- **Backpressure.** Fan-out writes to slow clients can accumulate. *Mitigation:* coalesce
  quotes to latest-per-symbol-per-tick (already noted in §9) and drop laggards rather than
  buffer unboundedly.

### Opportunities to Simplify (one container, maximally simple)

- **Fold bootstrap reads into one SSE snapshot.** Instead of the client calling
  `/api/quotes` + `/api/instruments` + then opening `/api/stream`, emit an initial
  `snapshot` event (instruments + current quotes + portfolio) as the first SSE message.
  One round trip to "live," fewer endpoints to maintain, and it doubles as the
  reconnect-resync mechanism.
- **Drop TanStack Query for v1.** With SSE already pushing portfolio/quote state, a small
  `useReducer`/context store fed by the stream is enough; REST is only for
  mutations (place order) and the one-shot chat call. Removing the dependency shrinks the
  bundle and the mental model.
- **Reconsider persisting chat.** The `chat_messages` table (§6) adds a read/write path and
  schema surface for a single-tenant local sim. Keeping the last N turns in memory (lost on
  restart) is simpler and probably fine for v1; drop the table until cross-restart history
  is a real requirement.
- **Simplify the AI contract to tool-calls or a flat object.** Two tools
  (`emit_analysis`, `propose_orders`) or a single flat object with an optional `orders[]`
  is simpler to prompt and more portable across providers than `z.discriminatedUnion`.
- **Candle buffer can wait.** For M1/M2 the chart can render from the live quote stream
  alone; the 300-candle in-memory history (§7) is an optimization, not a requirement — add
  it when the chart actually needs backfill.
- **Delete the `drizzle-kit` alternative from §3.** The hand-rolled runner (already in
  `migrate.ts`) is fine and simpler; naming an unused alternative invites future churn.

### Doc-vs-Implementation Drift (M1)

- **Dockerfile install strategy differs materially.** §13 specifies `npm ci` (build) and
  `npm ci --omit=dev --workspace server --workspace shared` (runtime). The actual
  `Dockerfile` uses `npm install --no-audit --no-fund` then `npm prune --omit=dev` and
  copies the **entire pruned `node_modules`** from the build stage into runtime.
  Consequences: `npm install` is less reproducible and may mutate the lockfile (vs
  `npm ci`), and the runtime image ships all three workspaces' hoisted prod deps rather
  than only server+shared. Reconcile: update §13's code block to match, or switch the
  Dockerfile back to `npm ci`.
- **Toolchain + resiliency additions not in the doc.** The real Dockerfile adds an apt
  build-toolchain fallback (python3/make/g++) and npm fetch-retry env vars that §13 does
  not mention. Additive and reasonable, but the doc should note them so §17's "no compiler
  needed" claim is qualified. *(Build note: in this sandbox the image only builds with
  `docker build --network=host`, because the default buildkit network cannot reach the npm
  registry — a host/network constraint, not a Dockerfile defect.)*
- **Healthcheck differs.** §13 hardcodes `http://localhost:8080/api/health`; the real
  Dockerfile parameterizes the port via `process.env.PORT||8080` and adds
  `--interval/--timeout/--start-period/--retries`. The code is better — update §13.
- **AI-schema field casing drift.** The real `ai-schema.ts` uses `riskFlags` and
  `limitPrice` (camelCase), while §10.2's illustrative schema uses `risk_flags` and
  `limit_price` (snake_case) — and the SQL/API (§6, §11) uses `limit_price`. Pick one
  casing for the wire/prompt contract; right now doc, DB, and Zod disagree.
- **`observations` default drift.** Real `AnalysisSchema.observations` has `.default([])`;
  §10.2's version does not. Align them (and don't advertise a JSON-Schema default the model
  can't honor).
- **`AI_API_KEY` "REQUIRED" vs optional.** §12 labels `AI_API_KEY` **REQUIRED** and claims
  the process "fails fast if required vars are missing," but `config.ts` declares it
  `.optional()` and derives an `aiEnabled` flag — the app boots fine with no key and AI is
  simply disabled. The code behavior is arguably better; fix the doc (mark it "required
  only to enable AI") or the code.
- **Auth gate not yet implemented.** `index.ts` registers only `healthRoutes` and
  `portfolioRoutes` (expected for M1), and there is **no `APP_SHARED_SECRET` gate** despite
  §12/§10.4 implying one. Not an M1 defect, but track it: the moment `/api/ai/chat` lands
  without that gate, the money-spending endpoint is open.

---

## 20. AI Inference & Optional Real Market Data

Two design decisions that refine the AI co-pilot (§10) and the market data layer (§7),
both implemented in a way that keeps our TypeScript stack and the single-container rule.

### 20.1 Cerebras inference skill (`.claude/skills/cerebras/`)

The AI co-pilot calls an LLM through the **OpenAI-compatible OpenRouter** endpoint,
pinning **Cerebras** as the inference provider for low latency, and validates the reply
as a **Zod-typed structured output**. The core idiom (TypeScript):

```ts
export const MODEL = 'openai/gpt-oss-120b';
export const PROVIDER_ROUTING = { provider: { order: ['cerebras'] } };

const res = await client.chat.completions.create({
  model: MODEL,
  messages,
  reasoning_effort: 'low',
  response_format: { type: 'json_schema', json_schema: { /* zodToJsonSchema(...) */ } },
  // @ts-expect-error passed through to OpenRouter
  extra_body: PROVIDER_ROUTING,
});
```

The full recipe lives at `.claude/skills/cerebras/SKILL.md` and validates against
`CoPilotResponseSchema` in `shared/ai-schema.ts`, implementing §10.2. It also documents an
`AI_MOCK=true` deterministic mode so tests and local dev run without an API key. On free
OpenRouter models `PROVIDER_ROUTING` is dropped (free tiers don't reliably honor a forced
provider).

### 20.2 Optional real market data (`MASSIVE_API_KEY`)

The simulator (§7) stays the default and only source needed for a fully self-contained
run. A single env var optionally swaps in real quotes, selected once at startup behind the
same provider interface:

```
MASSIVE_API_KEY=""        → GBM simulator (default, recommended, fully self-contained)
MASSIVE_API_KEY="pk_..."  → real quotes via the Massive/Polygon REST API
```

- Add `MASSIVE_API_KEY` to `config.ts` and `.env.example` (empty default).
- A `market/provider.ts` factory returns `SimulatorProvider` when the key is empty and a
  TS `MassiveProvider` (thin `fetch` client against the Massive/Polygon REST API) when set
  — both implementing the same interface the simulator already exposes. SSE, the price
  cache, and the frontend stay source-agnostic. The poller respects the API tier and
  degrades gracefully to a stale cache on failure rather than crashing.

Both the default (self-contained, no external calls) and the real-data path run **in the
same single container** — the provider is just another in-process module, never a separate
service.

---

*End of plan.*
