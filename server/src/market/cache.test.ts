// Unit tests for PriceCache — candle bucketing, buffer trim, and quote snapshot.
// Pure (no DB, no bus), so no env setup needed.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANDLE_INTERVAL_MS, CANDLE_BUFFER_SIZE } from '@finally/shared';
import { PriceCache } from './cache.js';

const T0 = 1_000_000_000_000; // fixed base ts; bucket-aligned reasoning below

test('init sets the live price and an empty candle history', () => {
  const c = new PriceCache();
  c.init('AAPL', 200, T0);
  assert.equal(c.get('AAPL'), 200);
  assert.deepEqual(c.getCandles('AAPL'), []);
});

test('updates within the same interval extend the open candle, none closed', () => {
  const c = new PriceCache();
  c.init('AAPL', 200, T0);
  assert.equal(c.update('AAPL', 205, T0 + 100), null);
  assert.equal(c.update('AAPL', 195, T0 + 200), null);
  assert.equal(c.get('AAPL'), 195);
  assert.deepEqual(c.getCandles('AAPL'), []); // nothing closed yet
});

test('crossing into a new interval closes the prior candle with correct OHLC', () => {
  const c = new PriceCache();
  c.init('AAPL', 200, T0);
  c.update('AAPL', 210, T0 + 100); // high
  c.update('AAPL', 190, T0 + 200); // low
  c.update('AAPL', 205, T0 + 300); // close-of-bucket
  // Next tick lands in the following interval → closes the first candle.
  const closed = c.update('AAPL', 206, T0 + CANDLE_INTERVAL_MS + 1);
  assert.ok(closed);
  assert.equal(closed?.o, 200);
  assert.equal(closed?.h, 210);
  assert.equal(closed?.l, 190);
  assert.equal(closed?.c, 205);
  // Candle ts is the bucket-open time, not the tick that closed it.
  assert.equal(closed?.ts, Math.floor(T0 / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS);
  assert.equal(c.getCandles('AAPL').length, 1);
});

test('candle buffer is trimmed to CANDLE_BUFFER_SIZE', () => {
  const c = new PriceCache();
  c.init('AAPL', 100, T0);
  // Push well past the cap: one tick per interval → one closed candle each.
  const n = CANDLE_BUFFER_SIZE + 50;
  for (let i = 1; i <= n; i++) {
    c.update('AAPL', 100 + i, T0 + i * CANDLE_INTERVAL_MS);
  }
  assert.equal(c.getCandles('AAPL').length, CANDLE_BUFFER_SIZE);
});

test('quotes() returns a snapshot of all current prices', () => {
  const c = new PriceCache();
  c.init('AAPL', 200, T0);
  c.init('MSFT', 450, T0);
  c.update('AAPL', 201, T0 + 10);
  const q = c.quotes(T0 + 20).sort((a, b) => a.symbol.localeCompare(b.symbol));
  assert.deepEqual(q, [
    { symbol: 'AAPL', price: 201, ts: T0 + 20 },
    { symbol: 'MSFT', price: 450, ts: T0 + 20 },
  ]);
});

test('get() is undefined for an unknown symbol', () => {
  const c = new PriceCache();
  assert.equal(c.get('NOPE'), undefined);
});
