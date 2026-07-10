// M1 read-only portfolio + instruments endpoints. These prove the database
// round-trips and give the web shell something real to render. Live marks and
// P&L math arrive with the market simulator in the next milestone; for now
// positions are marked at their average price.

import type { FastifyInstance } from 'fastify';
import type { Instrument, Portfolio, PositionView } from '@finally/shared';
import { getCash, getInstruments, getPositions } from '../db/queries.js';

export async function portfolioRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/instruments', async (): Promise<Instrument[]> => {
    return getInstruments();
  });

  app.get('/api/portfolio', async (): Promise<Portfolio> => {
    const cash = getCash();
    const positions = getPositions();

    // Until the simulator lands, mark at cost so P&L reads zero rather than wrong.
    const views: PositionView[] = positions.map((p) => {
      const mark = p.avgPrice;
      const marketValue = p.quantity * mark;
      return {
        ...p,
        mark,
        marketValue,
        unrealizedPnl: (mark - p.avgPrice) * p.quantity,
      };
    });

    const equity = cash + views.reduce((sum, v) => sum + v.marketValue, 0);
    const unrealizedPnl = views.reduce((sum, v) => sum + v.unrealizedPnl, 0);

    return { cash, positions: views, equity, unrealizedPnl, updatedAt: Date.now() };
  });
}
