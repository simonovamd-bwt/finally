// Quote snapshot route (plan §11). GET /api/quotes returns the current price of
// every instrument from the in-memory cache (not persisted per tick, plan §6).

import type { FastifyInstance } from 'fastify';
import type { Quote } from '@finally/shared';
import type { AppContext } from '../context.js';

export function quoteRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/api/quotes', async (): Promise<Quote[]> => {
      return ctx.cache.quotes(Date.now());
    });
  };
}
