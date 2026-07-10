// Server bootstrap: the single runtime process. Boots the database, mounts the
// API routes, serves the compiled SPA as static files (with client-side routing
// fallback), and shuts down gracefully.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { db } from './db/connection.js';
import { initDatabase } from './db/migrate.js';
import { healthRoutes } from './routes/health.js';
import { portfolioRoutes } from './routes/portfolio.js';

const here = dirname(fileURLToPath(import.meta.url));

// In the container/build layout, the SPA is at <repo>/web/dist. From
// server/dist that resolves to ../../web/dist.
const webDist = resolve(here, '../../web/dist');

async function main(): Promise<void> {
  // 1) Database: migrate + seed before serving traffic.
  initDatabase();

  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
  });

  // 2) API routes.
  await app.register(healthRoutes);
  await app.register(portfolioRoutes);

  // 3) Static SPA (if built). Serves assets and falls back to index.html for
  //    client-side routes. In dev the Vite server handles the frontend instead.
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

  // 4) Listen.
  await app.listen({ port: config.PORT, host: '0.0.0.0' });

  // 5) Graceful shutdown: close HTTP, then the database.
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    try {
      await app.close();
      db.close();
    } finally {
      process.exit(0);
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
