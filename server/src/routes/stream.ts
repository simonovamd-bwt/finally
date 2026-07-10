// SSE endpoint (plan §9). GET /api/stream opens a persistent text/event-stream,
// sends an initial snapshot (instruments + quotes + candles + portfolio) so the
// client is immediately live and reconnect-resyncs, then streams bus events via
// the broker until the client disconnects.

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getInstruments } from '../db/queries.js';
import { buildPortfolio } from '../trading/portfolio.js';
import { addClient, sendSnapshot } from '../sse/broker.js';

export function streamRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/api/stream', (req, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // disable proxy buffering (plan §19)
      });

      const ts = Date.now();
      const instruments = getInstruments();
      sendSnapshot(reply, {
        instruments,
        quotes: ctx.cache.quotes(ts),
        candles: Object.fromEntries(
          instruments.map((i) => [i.symbol, ctx.cache.getCandles(i.symbol)]),
        ),
        portfolio: buildPortfolio(ctx.cache),
      });

      const cleanup = addClient(reply);
      req.raw.on('close', cleanup);
    });
  };
}
