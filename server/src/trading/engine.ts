// Trading engine (plan §8). The SOLE mutator of money — human orders and AI
// proposals both funnel through submitOrder() with the same validation. No
// privileged path for the AI. Every fill settles atomically in one SQLite
// transaction, then broadcasts `fill` + `portfolio` on the bus for SSE.

import { randomUUID } from 'node:crypto';
import {
  DEFAULT_FEE,
  MONEY_EPSILON,
  type Fill,
  type Order,
  type OrderSide,
  type PlaceOrderInput,
} from '@finally/shared';
import { config } from '../config.js';
import { bus } from '../bus.js';
import { db } from '../db/connection.js';
import { getPendingLimitOrders, instrumentExists } from '../db/queries.js';
import type { PriceCache } from '../market/cache.js';
import { buildPortfolio } from './portfolio.js';

export interface SubmitResult {
  order: Order;
  fill: Fill | null; // null when a limit order rests as pending
}

/** Round to cents to keep persisted money values free of float dust. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class OrderRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderRejectedError';
  }
}

/**
 * Pure position-update math (exported for unit tests). Given the current
 * position and a fill, returns the new signed quantity, new average price, and
 * the realized P&L produced by any portion that reduces/closes the position.
 */
export function applyFill(
  prevQty: number,
  prevAvg: number,
  side: OrderSide,
  fillQty: number,
  fillPrice: number,
): { quantity: number; avgPrice: number; realizedPnl: number } {
  const signed = side === 'buy' ? fillQty : -fillQty;
  const newQty = prevQty + signed;

  // Increasing (or opening) a position in the same direction → blend avg price.
  const sameDirection = prevQty === 0 || Math.sign(prevQty) === Math.sign(signed);
  if (sameDirection) {
    const avgPrice =
      prevQty === 0
        ? fillPrice
        : (prevAvg * Math.abs(prevQty) + fillPrice * Math.abs(signed)) /
          Math.abs(newQty || 1);
    return { quantity: newQty, avgPrice, realizedPnl: 0 };
  }

  // Reducing / closing / flipping: realize P&L on the closed amount.
  const closedQty = Math.min(Math.abs(signed), Math.abs(prevQty));
  // For a long being sold: (sell − avg) * qty. For a short being covered:
  // (avg − buy) * qty. prevQty sign encodes direction.
  const direction = prevQty > 0 ? 1 : -1;
  const realizedPnl = (fillPrice - prevAvg) * closedQty * direction;

  if (Math.abs(signed) <= Math.abs(prevQty)) {
    // Partial or full close, no flip. Avg price unchanged; flat → reset to 0.
    const avgPrice = newQty === 0 ? 0 : prevAvg;
    return { quantity: newQty, avgPrice, realizedPnl };
  }

  // Flip through zero: remainder opens a new position at the fill price.
  return { quantity: newQty, avgPrice: fillPrice, realizedPnl };
}

export class TradingEngine {
  constructor(private readonly cache: PriceCache) {}

  /** Validate + (attempt to) fill an order. Throws OrderRejectedError on reject. */
  submitOrder(input: PlaceOrderInput): SubmitResult {
    const source = input.source ?? 'human';
    const symbol = input.symbol.toUpperCase();

    if (!instrumentExists(symbol)) {
      throw new OrderRejectedError(`unknown symbol: ${symbol}`);
    }
    if (!(input.quantity > 0)) {
      throw new OrderRejectedError('quantity must be positive');
    }

    const mark = this.cache.get(symbol);
    if (mark === undefined) {
      throw new OrderRejectedError(`no market price for ${symbol}`);
    }

    // Determine the execution price and whether it fills now.
    let fillPrice: number | null = null;
    if (input.type === 'market') {
      fillPrice = mark;
    } else {
      // Limit: fills if the current mark already satisfies the limit.
      const lp = input.limitPrice as number;
      if (input.side === 'buy' && mark <= lp) fillPrice = mark;
      if (input.side === 'sell' && mark >= lp) fillPrice = mark;
    }

    const now = Date.now();
    const orderId = randomUUID();

    // Pre-flight balance/position checks when it would fill immediately.
    if (fillPrice !== null) {
      this.assertAffordable(input.side, input.quantity, fillPrice, symbol);
    }

    const settle = db.transaction((): SubmitResult => {
      db.prepare(
        `INSERT INTO orders
          (id, symbol, side, type, quantity, limit_price, status, source, reason, created_at, updated_at)
         VALUES (@id,@symbol,@side,@type,@quantity,@limitPrice,@status,@source,@reason,@createdAt,@updatedAt)`,
      ).run({
        id: orderId,
        symbol,
        side: input.side,
        type: input.type,
        quantity: input.quantity,
        limitPrice: input.limitPrice ?? null,
        status: fillPrice !== null ? 'filled' : 'pending',
        source,
        reason: input.reason ?? null,
        createdAt: now,
        updatedAt: now,
      });

      let fill: Fill | null = null;
      if (fillPrice !== null) {
        fill = this.executeFill(orderId, symbol, input.side, input.quantity, fillPrice, now);
      }

      const order = this.readOrder(orderId);
      return { order, fill };
    });

    const result = settle();

    // Broadcast outside the transaction.
    if (result.fill) {
      bus.emitTyped('fill', result.fill);
      bus.emitTyped('portfolio', buildPortfolio(this.cache));
    }
    return result;
  }

  /**
   * Sweep resting limit orders against the current marks. Called on each tick.
   * Fills any that now cross; broadcasts fills + one portfolio update.
   */
  matchPending(): void {
    const pending = getPendingLimitOrders();
    if (pending.length === 0) return;

    let filledAny = false;
    for (const order of pending) {
      const mark = this.cache.get(order.symbol);
      if (mark === undefined || order.limitPrice === null) continue;

      const crosses =
        (order.side === 'buy' && mark <= order.limitPrice) ||
        (order.side === 'sell' && mark >= order.limitPrice);
      if (!crosses) continue;

      // Skip if no longer affordable (e.g. cash spent since the order rested).
      if (!this.isAffordable(order.side, order.quantity, mark, order.symbol)) {
        continue;
      }

      const now = Date.now();
      const fill = db.transaction((): Fill => {
        const f = this.executeFill(
          order.id,
          order.symbol,
          order.side,
          order.quantity,
          mark,
          now,
        );
        db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(
          'filled',
          now,
          order.id,
        );
        return f;
      })();

      bus.emitTyped('fill', fill);
      filledAny = true;
    }

    if (filledAny) bus.emitTyped('portfolio', buildPortfolio(this.cache));
  }

  // ── internals ───────────────────────────────────────

  /** Write the fill, update position + cash. MUST run inside a transaction. */
  private executeFill(
    orderId: string,
    symbol: string,
    side: OrderSide,
    quantity: number,
    price: number,
    ts: number,
  ): Fill {
    const fee = DEFAULT_FEE;

    const posRow = db
      .prepare('SELECT quantity, avg_price FROM positions WHERE symbol = ?')
      .get(symbol) as { quantity: number; avg_price: number } | undefined;
    const prevQty = posRow?.quantity ?? 0;
    const prevAvg = posRow?.avg_price ?? 0;

    const next = applyFill(prevQty, prevAvg, side, quantity, price);

    // Flatten to zero when the residual is float dust, not just an exact 0 —
    // otherwise fractional shares can leave a ~1e-17 position (or dust short).
    if (Math.abs(next.quantity) < MONEY_EPSILON) {
      db.prepare('DELETE FROM positions WHERE symbol = ?').run(symbol);
    } else {
      db.prepare(
        `INSERT INTO positions (symbol, quantity, avg_price, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
           quantity = excluded.quantity,
           avg_price = excluded.avg_price,
           updated_at = excluded.updated_at`,
      ).run(symbol, next.quantity, round2(next.avgPrice), ts);
    }

    // Cash: buys debit (notional + fee), sells credit (notional − fee).
    // Fold realized P&L (from any closing portion) into the same account write,
    // so settlement stays atomic (plan §8).
    const notional = quantity * price;
    const cashDelta = side === 'buy' ? -(notional + fee) : notional - fee;
    db.prepare(
      `UPDATE account
         SET cash = cash + ?,
             realized_pnl = realized_pnl + ?,
             updated_at = ?
       WHERE id = 1`,
    ).run(round2(cashDelta), round2(next.realizedPnl), ts);

    const fill: Fill = {
      id: randomUUID(),
      orderId,
      symbol,
      side,
      quantity,
      price,
      fee,
      createdAt: ts,
    };
    db.prepare(
      `INSERT INTO fills (id, order_id, symbol, side, quantity, price, fee, created_at)
       VALUES (@id,@orderId,@symbol,@side,@quantity,@price,@fee,@createdAt)`,
    ).run(fill);

    return fill;
  }

  private assertAffordable(
    side: OrderSide,
    quantity: number,
    price: number,
    symbol: string,
  ): void {
    if (!this.isAffordable(side, quantity, price, symbol)) {
      throw new OrderRejectedError(
        side === 'buy' ? 'insufficient cash' : 'insufficient position to sell',
      );
    }
  }

  private isAffordable(
    side: OrderSide,
    quantity: number,
    price: number,
    symbol: string,
  ): boolean {
    if (side === 'buy') {
      const cash = (
        db.prepare('SELECT cash FROM account WHERE id = 1').get() as {
          cash: number;
        }
      ).cash;
      const cost = quantity * price + DEFAULT_FEE;
      return cost <= cash + MONEY_EPSILON;
    }
    // sell
    if (config.ALLOW_SHORTING) return true;
    const posRow = db
      .prepare('SELECT quantity FROM positions WHERE symbol = ?')
      .get(symbol) as { quantity: number } | undefined;
    const held = posRow?.quantity ?? 0;
    return held + MONEY_EPSILON >= quantity;
  }

  private readOrder(id: string): Order {
    const r = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as {
      id: string;
      symbol: string;
      side: OrderSide;
      type: 'market' | 'limit';
      quantity: number;
      limit_price: number | null;
      status: Order['status'];
      source: Order['source'];
      reason: string | null;
      created_at: number;
      updated_at: number;
    };
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
}
