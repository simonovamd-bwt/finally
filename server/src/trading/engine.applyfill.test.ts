// Pure unit tests for applyFill — the position/avg-price/realized-P&L math.
// No database, no market: just the accounting invariants (plan §8).

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// engine.js transitively imports the DB connection, which opens a file at
// DATABASE_PATH on import. Point it at a temp dir so importing is side-effect safe.
process.env.DATABASE_PATH = join(
  mkdtempSync(join(tmpdir(), 'finally-applyfill-')),
  'test.db',
);

const { applyFill } = await import('./engine.js');

test('opening a long sets avg price to fill price', () => {
  const r = applyFill(0, 0, 'buy', 10, 100);
  assert.equal(r.quantity, 10);
  assert.equal(r.avgPrice, 100);
  assert.equal(r.realizedPnl, 0);
});

test('adding to a long blends the average price', () => {
  // 10 @ 100, then 10 @ 120 → 20 @ 110
  const r = applyFill(10, 100, 'buy', 10, 120);
  assert.equal(r.quantity, 20);
  assert.equal(r.avgPrice, 110);
  assert.equal(r.realizedPnl, 0);
});

test('partial close realizes P&L on the closed amount, keeps avg', () => {
  // Long 10 @ 100, sell 4 @ 130 → realized (130-100)*4 = 120, remain 6 @ 100
  const r = applyFill(10, 100, 'sell', 4, 130);
  assert.equal(r.quantity, 6);
  assert.equal(r.avgPrice, 100);
  assert.equal(r.realizedPnl, 120);
});

test('full close realizes P&L and flattens to zero', () => {
  const r = applyFill(10, 100, 'sell', 10, 90);
  assert.equal(r.quantity, 0);
  assert.equal(r.avgPrice, 0);
  assert.equal(r.realizedPnl, -100); // (90-100)*10
});

test('selling more than held flips to a short, realizing on the closed part', () => {
  // Long 10 @ 100, sell 15 @ 120 → close 10 (realize +200), open short 5 @ 120
  const r = applyFill(10, 100, 'sell', 15, 120);
  assert.equal(r.quantity, -5);
  assert.equal(r.avgPrice, 120);
  assert.equal(r.realizedPnl, 200);
});

test('covering a short realizes P&L correctly', () => {
  // Short 10 @ 100 (sold high), buy 4 @ 80 → realize (100-80)*4 = 80
  const r = applyFill(-10, 100, 'buy', 4, 80);
  assert.equal(r.quantity, -6);
  assert.equal(r.avgPrice, 100);
  assert.equal(r.realizedPnl, 80);
});
