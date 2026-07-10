// Server bootstrap: the single runtime process. Boots the database, starts the
// market data provider (simulator or Massive), mounts the API + SSE routes,
// serves the compiled SPA, matches resting limit orders each tick, and shuts
// down gracefully (stop ticking → close SSE → close HTTP → close DB).

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { bus } from './bus.js';
import { createContext } from './context.js';
import { db } from './db/connection.js';
import { initDatabase } from './db/migrate.js';
import { createMarketDataProvider } from './market/provider.js';
import { closeAll as closeSse } from './sse/broker.js';
import { healthRoutes } from './routes/health.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { quoteRoutes } from './routes/quotes.js';
import { orderRoutes } from './routes/orders.js';
import { streamRoutes } from './routes/stream.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(here, '../../web/dist');

async function main(): Promise<void> {
  // 1) Database: migrate + seed before serving traffic.
  initDatabase();

  // 2) Runtime singletons (price cache + trading engine).
  const ctx = createContext();

  // 3) Market data provider: simulator by default, Massive if a key is set.
  const provider = await createMarketDataProvider(ctx.cache);
  provider.start();

  // 4) On every quote tick, sweep resting limit orders for fills.
  bus.onTyped('quote', () => ctx.engine.matchPending());

  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  // 5) API + SSE routes.
  await app.register(healthRoutes);
  await app.register(portfolioRoutes(ctx));
  await app.register(quoteRoutes(ctx));
  await app.register(orderRoutes(ctx));
  await app.register(streamRoutes(ctx));

  // 6) Static SPA (if built), with client-side routing fallback.
  const hasWeb = existsSync(join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url && req.raw.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      reply.type('text/html').sendFile('index.html');
    });
    app.log.info(`serving SPA from ${webDist}`);
  } else {
    app.log.warn(`no SPA build found at ${webDist} (run "npm run build:web")`);
  }

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info(`market data provider: ${provider.name}`);

  // 7) Graceful shutdown: stop ticking → close SSE → close HTTP → close DB.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`received ${signal}, shutting down`);
    let code = 0;
    try {
      provider.stop();
      closeSse();
      await app.close();
      db.close();
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      code = 1;
    } finally {
      process.exit(code);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal: failed to start server', err);
  process.exit(1);
});
