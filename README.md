# Finally — Finance Ally

A stunning, AI-powered **simulated** trading workstation. Bloomberg-terminal
aesthetics, a live market data stream (SSE), a simulated trading portfolio, and an
LLM co-pilot. Everything runs in **one Docker container**.

> See [`planning/plan.md`](./planning/plan.md) for the full architecture and roadmap.

## Status

**M1 foundation** — the scaffold is in place:

- Node.js + Fastify backend (single process) with `/api/health`.
- Persistent **SQLite** (`better-sqlite3`, WAL) seeded on first run.
- React + Vite + Tailwind terminal **shell** with a live Status Bar.
- Single multi-stage **Dockerfile** + `docker-compose.yml` with a `/data` volume.

Market simulator, trading engine, and AI co-pilot land in later milestones.

## Quick start (Docker — the intended way)

```bash
cp .env.example .env          # optional for M1; set AI_API_KEY later for the co-pilot
docker compose up --build
# open http://localhost:8080
```

The SQLite database lives on the named volume `finally-data` at `/data/finally.db`, so
your data survives `docker compose down` / `up`.

### Persistence check

```bash
docker compose up --build -d
curl -s localhost:8080/api/health        # { "ok": true, ... }
docker compose down                       # stop & remove the container (keeps the volume)
docker compose up -d                       # same DB file is reattached
```

## Local development (without Docker)

Requires Node.js 20+.

```bash
npm install
npm run build:shared          # build shared types once

# terminal 1 — backend (serves API on :8080)
DATABASE_PATH=./data/finally.db npm run dev:server

# terminal 2 — frontend dev server (proxies /api → :8080)
npm run dev:web               # open http://localhost:5173
```

For a production-style single-process run locally:

```bash
npm run build
DATABASE_PATH=./data/finally.db npm start   # serves API + built SPA on :8080
```

## Layout

```
finally/
├── shared/   # types & schemas shared by server and web
├── server/   # Fastify backend — the only runtime process (serves API + built SPA)
├── web/      # React + Vite SPA (compiled to static, served by the server)
├── Dockerfile
└── docker-compose.yml
```

## Environment variables

See [`.env.example`](./.env.example). Secrets (`AI_API_KEY`, `APP_SHARED_SECRET`) are
read only server-side and never reach the browser.

## License

MIT — see [`LICENSE`](./LICENSE).
