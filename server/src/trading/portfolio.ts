// Portfolio read model (plan §8). Computes positions marked to the live price,
// market value, unrealized P&L, and total equity. The DB is the ledger; marks
// come from the in-memory PriceCache.

import type { Portfolio, PositionView } from '@finally/shared';
import { getCash, getPositions, getRealizedPnl } from '../db/queries.js';
import type { PriceCache } from '../market/cache.js';

export function buildPortfolio(cache: PriceCache): Portfolio {
  const cash = getCash();
  const positions = getPositions();

  const views: PositionView[] = positions.map((p) => {
    // Fall back to avg price if the cache has no mark yet (pre-first-tick).
    const mark = cache.get(p.symbol) ?? p.avgPrice;
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
  const realizedPnl = getRealizedPnl();

  return {
    cash,
    positions: views,
    equity,
    unrealizedPnl,
    realizedPnl,
    updatedAt: Date.now(),
  };
}
