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

before(async () => {
  ({ db } = await import('../db/connection.js'));
  ({ initDatabase } = await import('../db/migrate.js'));
  ({ PriceCache } = await import('../market/cache.js'));
  ({ TradingEngine, OrderRejectedError } = await import('./engine.js'));
  ({ getCash } = await import('../db/queries.js'));
  initDatabase();
});

function resetState(): void {
  db.exec('DELETE FROM fills; DELETE FROM orders; DELETE FROM positions;');
  db.prepare('UPDATE account SET cash = 100000 WHERE id = 1').run();
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
