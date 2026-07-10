// Thin typed accessors over the database. M1 read model + M2 order/fill writes.
// All money-moving mutations happen inside engine.ts transactions, not here.

import type {
  Fill,
  Instrument,
  Order,
  OrderStatus,
  Position,
} from '@finally/shared';
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

interface OrderRow {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  limit_price: number | null;
  status: OrderStatus;
  source: 'human' | 'ai';
  reason: string | null;
  created_at: number;
  updated_at: number;
}

interface FillRow {
  id: string;
  order_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  fee: number;
  created_at: number;
}

// ── Reads ─────────────────────────────────────────────

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

export function instrumentExists(symbol: string): boolean {
  return (
    db.prepare('SELECT 1 FROM instruments WHERE symbol = ?').get(symbol) !==
    undefined
  );
}

export function getCash(): number {
  const row = db.prepare('SELECT cash FROM account WHERE id = 1').get() as
    | { cash: number }
    | undefined;
  return row?.cash ?? 0;
}

export function getRealizedPnl(): number {
  const row = db
    .prepare('SELECT realized_pnl FROM account WHERE id = 1')
    .get() as { realized_pnl: number } | undefined;
  return row?.realized_pnl ?? 0;
}

export function getPositions(): Position[] {
  const rows = db
    .prepare('SELECT * FROM positions ORDER BY symbol')
    .all() as PositionRow[];
  return rows.map(mapPosition);
}

export function getPosition(symbol: string): Position | null {
  const r = db
    .prepare('SELECT * FROM positions WHERE symbol = ?')
    .get(symbol) as PositionRow | undefined;
  return r ? mapPosition(r) : null;
}

export function getOrders(limit: number, status?: OrderStatus): Order[] {
  const rows = (
    status
      ? db
          .prepare(
            'SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?',
          )
          .all(status, limit)
      : db
          .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?')
          .all(limit)
  ) as OrderRow[];
  return rows.map(mapOrder);
}

export function getPendingLimitOrders(): Order[] {
  const rows = db
    .prepare("SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at")
    .all() as OrderRow[];
  return rows.map(mapOrder);
}

export function getFills(limit: number): Fill[] {
  const rows = db
    .prepare('SELECT * FROM fills ORDER BY created_at DESC LIMIT ?')
    .all(limit) as FillRow[];
  return rows.map(mapFill);
}

// ── Mappers ───────────────────────────────────────────

function mapPosition(r: PositionRow): Position {
  return {
    symbol: r.symbol,
    quantity: r.quantity,
    avgPrice: r.avg_price,
    updatedAt: r.updated_at,
  };
}

function mapOrder(r: OrderRow): Order {
  return {
    id: r.id,
    symbol: r.symbol,
    side: r.side,
    type: r.type,
    quantity: r.quantity,
    limitPrice: r.limit_price,
    status: r.status,
    source: r.source,
    reason: r.reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFill(r: FillRow): Fill {
  return {
    id: r.id,
    orderId: r.order_id,
    symbol: r.symbol,
    side: r.side,
    quantity: r.quantity,
    price: r.price,
    fee: r.fee,
    createdAt: r.created_at,
  };
}
