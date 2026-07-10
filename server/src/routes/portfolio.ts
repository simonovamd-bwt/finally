// Portfolio + instruments endpoints (plan §11). Portfolio is marked to live
// prices from the in-memory cache via buildPortfolio().

import type { FastifyInstance } from 'fastify';
import type { Instrument, Portfolio } from '@finally/shared';
import type { AppContext } from '../context.js';
import { getInstruments } from '../db/queries.js';
import { buildPortfolio } from '../trading/portfolio.js';

export function portfolioRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance): Promise<void> {
    app.get('/api/instruments', async (): Promise<Instrument[]> => {
      return getInstruments();
    });

    app.get('/api/portfolio', async (): Promise<Portfolio> => {
      return buildPortfolio(ctx.cache);
    });
  };
}
