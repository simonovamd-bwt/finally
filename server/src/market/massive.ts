// Optional real market data via the Massive (Polygon.io) REST API (plan §20.2).
// Active only when MASSIVE_API_KEY is set. A thin fetch client — no SDK — polls
// the snapshot endpoint, writes into the shared PriceCache, and emits the same
// `quote`/`candle` bus events as the simulator, so consumers are source-agnostic.
// On any network/auth failure it logs and keeps the last cache (stale, not crash).

import { bus } from '../bus.js';
import { getInstruments } from '../db/queries.js';
import type { Quote } from '@finally/shared';
import type { PriceCache } from './cache.js';
import type { MarketDataProvider } from './provider.js';

const BASE_URL = 'https://api.massive.com';
// Conservative poll cadence to respect API tiers regardless of watchlist size.
const POLL_INTERVAL_MS = 3_000;

export class MassiveProvider implements MarketDataProvider {
  readonly name = 'massive';
  private timer: ReturnType<typeof setInterval> | null = null;
  private symbols: string[] = [];
  private polling = false; // overlap guard: skip a tick if the last poll runs long

  constructor(
    private readonly cache: PriceCache,
    private readonly apiKey: string,
  ) {}

  start(): void {
    const now = Date.now();
    const instruments = getInstruments();
    this.symbols = instruments.map((i) => i.symbol);
    // Seed from start prices so the UI has data before the first poll returns.
    for (const inst of instruments) {
      this.cache.init(inst.symbol, inst.startPrice, now);
    }
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    // If the previous poll is still running (slow network / large watchlist),
    // skip this tick rather than stacking overlapping request batches.
    if (this.polling) return;
    this.polling = true;
    const ts = Date.now();
    const quotes: Quote[] = [];
    try {
      for (const symbol of this.symbols) {
        const price = await this.fetchPrice(symbol);
        if (price === null) continue;
        const closed = this.cache.update(symbol, price, ts);
        quotes.push({ symbol, price, ts });
        if (closed) bus.emitTyped('candle', closed);
      }
      if (quotes.length > 0) bus.emitTyped('quote', quotes);
    } catch (err) {
      // Degrade gracefully: keep the stale cache rather than crash.
      // eslint-disable-next-line no-console
      console.warn(`[massive] poll failed, using stale cache: ${String(err)}`);
    } finally {
      this.polling = false;
    }
  }

  /** Fetch a single symbol's latest trade price; null on any failure. */
  private async fetchPrice(symbol: string): Promise<number | null> {
    try {
      const url = `${BASE_URL}/v2/last/trade/${encodeURIComponent(symbol)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { results?: { p?: number } };
      const price = body.results?.p;
      return typeof price === 'number' && price > 0 ? price : null;
    } catch {
      return null;
    }
  }
}
