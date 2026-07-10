// Integration tests for the trading engine against a real (temp) SQLite DB.
// Drives submitOrder end-to-end: fills, cash accounting, P&L, rejections, and
// limit-order resting + matchPending. Uses node:test; no external deps.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, before, beforeEach } from 'node:test';

// Isolate the DB before any module reads config.DATABASE_PATH.
const dir = mkdtempSync(join(tmpdir(), 'finally-test-'));
process.env.DATABASE_PATH = join(dir, 'test.db');
process.env.STARTING_CASH = '100000';
process.env.ALLOW_SHORTING = 'false';

// Dynamically imported after env is set.
let db: import('better-sqlite3').Database;
let initDatabase: () => void;
let PriceCache: typeof import('../market/cache.js').PriceCache;
let TradingEngine: typeof import('./engine.js').TradingEngine;
let OrderRejectedError: typeof import('./engine.js').OrderRejectedError;
let getCash: typeof import('../db/queries.js').getCash;
let getRealizedPnl: typeof import('../db/queries.js').getRealizedPnl;
let buildPortfolio: typeof import('./portfolio.js').buildPortfolio;

before(async () => {
  ({ db } = await import('../db/connection.js'));
  ({ initDatabase } = await import('../db/migrate.js'));
  ({ PriceCache } = await import('../market/cache.js'));
  ({ TradingEngine, OrderRejectedError } = await import('./engine.js'));
  ({ getCash, getRealizedPnl } = await import('../db/queries.js'));
  ({ buildPortfolio } = await import('./portfolio.js'));
  initDatabase();
});

function resetState(): void {
  db.exec('DELETE FROM fills; DELETE FROM orders; DELETE FROM positions;');
  db.prepare('UPDATE account SET cash = 100000, realized_pnl = 0 WHERE id = 1').run();
}

function freshEngine() {
  const cache = new PriceCache();
  const now = Date.now();
  cache.init('AAPL', 200, now); // deterministic mark for tests
  const engine = new TradingEngine(cache);
  return { cache, engine };
}

beforeEach(() => resetState());

test('market buy fills immediately and debits cash', () => {
  const { engine } = freshEngine();
  const { order, fill } = engine.submitOrder({
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    quantity: 10,
  });
  assert.equal(order.status, 'filled');
  assert.ok(fill);
  assert.equal(fill?.price, 200);
  assert.equal(getCash(), 100000 - 10 * 200); // 98000
});

test('market sell of held position credits cash and realizes P&L via portfolio', async () => {
  const { engine, cache } = freshEngine();
  engine.submitOrder({ symbol: 'AAPL', side: 'buy', type: 'market', quantity: 10 });
  // Price moves up, then sell.
  cache.update('AAPL', 220, Date.now());
  engine.submitOrder({ symbol: 'AAPL', side: 'sell', type: 'market', quantity: 10 });
  // Bought 10@200 (−2000), sold 10@220 (+2200) → cash 100200, flat position.
  assert.equal(getCash(), 100200);
  const { getPositions } = await import('../db/queries.js');
  assert.equal(getPositions().length, 0);
});

test('insufficient cash is rejected', () => {
  const { engine } = freshEngine();
  assert.throws(
    () =>
      engine.submitOrder({
        symbol: 'AAPL',
        side: 'buy',
        type: 'market',
        quantity: 1000, // 1000 * 200 = 200k > 100k cash
      }),
    OrderRejectedError,
  );
  assert.equal(getCash(), 100000); // unchanged
});

test('selling more than held is rejected when shorting disabled', () => {
  const { engine } = freshEngine();
  assert.throws(
    () =>
      engine.submitOrder({
        symbol: 'AAPL',
        side: 'sell',
        type: 'market',
        quantity: 5,
      }),
    OrderRejectedError,
  );
});

test('unknown symbol is rejected', () => {
  const { engine } = freshEngine();
  assert.throws(
    () =>
      engine.submitOrder({
        symbol: 'NOPE',
        side: 'buy',
        type: 'market',
        quantity: 1,
      }),
    OrderRejectedError,
  );
});

test('limit buy above market fills immediately', () => {
  const { engine } = freshEngine(); // mark = 200
  const { order, fill } = engine.submitOrder({
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    quantity: 5,
    limitPrice: 210, // willing to pay up to 210, market is 200 → fills at 200
  });
  assert.equal(order.status, 'filled');
  assert.equal(fill?.price, 200);
});

test('limit buy below market rests as pending, then fills on tick', () => {
  const { engine, cache } = freshEngine(); // mark = 200
  const { order, fill } = engine.submitOrder({
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    quantity: 5,
    limitPrice: 190, // below market → should rest
  });
  assert.equal(order.status, 'pending');
  assert.equal(fill, null);

  // Price drops to 188 → matchPending should now fill it.
  cache.update('AAPL', 188, Date.now());
  engine.matchPending();

  const row = db
    .prepare('SELECT status FROM orders WHERE id = ?')
    .get(order.id) as { status: string };
  assert.equal(row.status, 'filled');
  assert.equal(getCash(), 100000 - 5 * 188); // filled at the mark (188)
});

test('realized P&L is persisted and surfaced on the portfolio (Blocking #1 guard)', () => {
  const { engine, cache } = freshEngine();
  engine.submitOrder({ symbol: 'AAPL', side: 'buy', type: 'market', quantity: 10 }); // @200
  cache.update('AAPL', 260, Date.now());
  engine.submitOrder({ symbol: 'AAPL', side: 'sell', type: 'market', quantity: 10 }); // @260
  // Closing 10 @ (260-200) = +600 realized.
  assert.equal(getRealizedPnl(), 600);
  const pf = buildPortfolio(cache);
  assert.equal(pf.realizedPnl, 600);
  assert.equal(pf.positions.length, 0);
});

test('partial close accumulates realized P&L across multiple sells', () => {
  const { engine, cache } = freshEngine();
  engine.submitOrder({ symbol: 'AAPL', side: 'buy', type: 'market', quantity: 10 }); // @200
  cache.update('AAPL', 210, Date.now());
  engine.submitOrder({ symbol: 'AAPL', side: 'sell', type: 'market', quantity: 4 }); // +40
  cache.update('AAPL', 220, Date.now());
  engine.submitOrder({ symbol: 'AAPL', side: 'sell', type: 'market', quantity: 3 }); // +60
  // (210-200)*4 + (220-200)*3 = 40 + 60 = 100
  assert.equal(getRealizedPnl(), 100);
});

test('limit sell above market rests, then fills on an up-cross', () => {
  const { engine, cache } = freshEngine();
  engine.submitOrder({ symbol: 'AAPL', side: 'buy', type: 'market', quantity: 5 }); // hold 5 @200
  const { order, fill } = engine.submitOrder({
    symbol: 'AAPL',
    side: 'sell',
    type: 'limit',
    quantity: 5,
    limitPrice: 220, // above market (200) → rests
  });
  assert.equal(order.status, 'pending');
  assert.equal(fill, null);

  cache.update('AAPL', 225, Date.now()); // crosses up
  engine.matchPending();

  const row = db
    .prepare('SELECT status FROM orders WHERE id = ?')
    .get(order.id) as { status: string };
  assert.equal(row.status, 'filled');
  // Sold 5 @ 225 → realized (225-200)*5 = 125.
  assert.equal(getRealizedPnl(), 125);
});

test('exact-balance buy is accepted (epsilon guard does not spuriously reject)', () => {
  const { engine, cache } = freshEngine();
  cache.update('AAPL', 100, Date.now());
  // Spend exactly all cash: 1000 * 100 = 100000.
  const { order } = engine.submitOrder({
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    quantity: 1000,
  });
  assert.equal(order.status, 'filled');
  assert.equal(getCash(), 0);
});

test('fractional shares flatten cleanly (no dust position)', () => {
  const { engine, cache } = freshEngine();
  cache.update('AAPL', 100, Date.now());
  engine.submitOrder({ symbol: 'AAPL', side: 'buy', type: 'market', quantity: 0.1 });
  engine.submitOrder({ symbol: 'AAPL', side: 'buy', type: 'market', quantity: 0.1 });
  engine.submitOrder({ symbol: 'AAPL', side: 'buy', type: 'market', quantity: 0.1 });
  // 0.1+0.1+0.1 = 0.30000000000000004; selling 0.3 must delete the row, not
  // leave ~4e-17 behind.
  engine.submitOrder({ symbol: 'AAPL', side: 'sell', type: 'market', quantity: 0.3 });
  const pos = db
    .prepare('SELECT * FROM positions WHERE symbol = ?')
    .get('AAPL');
  assert.equal(pos, undefined);
});

test('portfolio equity = cash + marketValue, unrealized marks to live price', () => {
  const { engine, cache } = freshEngine();
  engine.submitOrder({ symbol: 'AAPL', side: 'buy', type: 'market', quantity: 10 }); // @200
  cache.update('AAPL', 230, Date.now());
  const pf = buildPortfolio(cache);
  // cash 98000, position 10 @ mark 230 → mv 2300, equity 100300.
  assert.equal(pf.cash, 98000);
  assert.equal(pf.equity, 100300);
  assert.equal(pf.unrealizedPnl, 300); // (230-200)*10
  assert.equal(pf.positions[0]?.marketValue, 2300);
});
