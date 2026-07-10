// GBM price simulator (plan §7). One setInterval updates every instrument each
// tick, writes to the PriceCache, and emits `quote` (and `candle` on close) on
// the bus. Optionally seeded from MARKET_SEED for reproducible demos.

import { config } from '../config.js';
import { bus } from '../bus.js';
import { getInstruments } from '../db/queries.js';
import type { Quote } from '@finally/shared';
import type { PriceCache } from './cache.js';
import type { MarketDataProvider } from './provider.js';

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

/** Mulberry32 — tiny deterministic PRNG so MARKET_SEED gives reproducible runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller: standard normal from two uniforms. */
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class SimulatorProvider implements MarketDataProvider {
  readonly name = 'simulator';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly rng: () => number;
  private readonly vols = new Map<string, number>();

  constructor(private readonly cache: PriceCache) {
    this.rng = config.MARKET_SEED
      ? mulberry32(hashSeed(config.MARKET_SEED))
      : Math.random;
  }

  start(): void {
    const now = Date.now();
    // Seed live prices from the DB instrument universe.
    for (const inst of getInstruments()) {
      this.cache.init(inst.symbol, inst.startPrice, now);
      this.vols.set(inst.symbol, inst.volatility);
    }

    this.timer = setInterval(() => this.tick(), config.TICK_INTERVAL_MS);
    // Do not keep the process alive solely for ticking.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (!config.MARKET_ALWAYS_OPEN && !isMarketOpen()) return;

    const ts = Date.now();
    const dt = config.TICK_INTERVAL_MS / MS_PER_YEAR;
    const quotes: Quote[] = [];

    for (const [symbol, vol] of this.vols) {
      const prev = this.cache.get(symbol);
      if (prev === undefined) continue;
      // GBM step: price *= exp((−0.5σ²)dt + σ√dt·Z)
      const drift = -0.5 * vol * vol * dt;
      const shock = vol * Math.sqrt(dt) * gaussian(this.rng);
      const next = Math.max(0.01, prev * Math.exp(drift + shock));
      const price = round2(next);

      const closed = this.cache.update(symbol, price, ts);
      quotes.push({ symbol, price, ts });
      if (closed) bus.emitTyped('candle', closed);
    }

    if (quotes.length > 0) bus.emitTyped('quote', quotes);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Simple US-equity-ish hours in UTC (approx). Only used when not always-open. */
function isMarketOpen(): boolean {
  const d = new Date();
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = d.getUTCHours();
  return hour >= 13 && hour < 21; // ~9:30–16:00 ET
}
