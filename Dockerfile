# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# Stage 1 — build: install all deps (compiling the native SQLite
# module), then build shared → web → server.
# ─────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

# better-sqlite3 ships prebuilt binaries (via prebuild-install) for this base
# image, so no compiler is normally needed. Install the build toolchain as a
# best-effort fallback for platforms without a prebuilt binary; don't fail the
# build if the apt mirror is unreachable (prebuilt binary will be used instead).
RUN (apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*) || echo "toolchain unavailable; relying on prebuilt binaries"

# Make npm resilient to flaky registry connectivity during the build.
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_factor=2 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_fetch_timeout=300000

# Install with the full workspace manifest set for good layer caching.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm install --no-audit --no-fund

# Copy sources and build every workspace.
COPY . .
RUN npm run build

# Drop dev dependencies in place; the native better-sqlite3 binary stays compiled.
RUN npm prune --omit=dev

# ─────────────────────────────────────────────────────────────
# Stage 2 — runtime: slim image, one Node process, one port.
# ─────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Pruned node_modules (incl. compiled better-sqlite3, same base image → ABI-compatible).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Built artifacts only.
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/web/dist ./web/dist

# SQLite database lives here on a mounted volume so it persists across restarts.
RUN mkdir -p /data
VOLUME ["/data"]
ENV DATABASE_PATH=/data/finally.db

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
