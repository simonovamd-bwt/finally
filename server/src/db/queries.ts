// Thin typed accessors over the database. Kept minimal for the M1 foundation;
// the trading milestone extends this with order/fill writes.

import type { Instrument, Position } from '@finally/shared';
import { db } from './connection.js';

interface InstrumentRow {
  symbol: string;
  name: string;
  start_price: number;
  volatility: number;
  created_at: number;
}

interface PositionRow {
  symbol: string;
  quantity: number;
  avg_price: number;
  updated_at: number;
}

export function getInstruments(): Instrument[] {
  const rows = db
    .prepare('SELECT * FROM instruments ORDER BY symbol')
    .all() as InstrumentRow[];
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    startPrice: r.start_price,
    volatility: r.volatility,
    createdAt: r.created_at,
  }));
}

export function getCash(): number {
  const row = db.prepare('SELECT cash FROM account WHERE id = 1').get() as
    | { cash: number }
    | undefined;
  return row?.cash ?? 0;
}

export function getPositions(): Position[] {
  const rows = db
    .prepare('SELECT * FROM positions ORDER BY symbol')
    .all() as PositionRow[];
  return rows.map((r) => ({
    symbol: r.symbol,
    quantity: r.quantity,
    avgPrice: r.avg_price,
    updatedAt: r.updated_at,
  }));
}
