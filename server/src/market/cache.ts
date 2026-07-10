// In-memory price cache + rolling candle buffers. This is the ONLY thing SSE
// and the trading engine read for live prices — neither the simulator nor the
// Massive poller talks to consumers directly (plan §7/§9). Prices are not
// persisted per tick (plan §6); only durable facts (orders/fills) hit SQLite.

import {
  CANDLE_BUFFER_SIZE,
  CANDLE_INTERVAL_MS,
  type Candle,
  type Quote,
} from '@finally/shared';

interface OpenCandle {
  bucket: number; // candle start ts (epoch ms, floored to interval)
  o: number;
  h: number;
  l: number;
  c: number;
}

export class PriceCache {
  private prices = new Map<string, number>();
  private candles = new Map<string, Candle[]>();
  private open = new Map<string, OpenCandle>();

  /** Seed a symbol at its start price with an initial open candle. */
  init(symbol: string, price: number, ts: number): void {
    this.prices.set(symbol, price);
    this.candles.set(symbol, []);
    this.open.set(symbol, {
      bucket: Math.floor(ts / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS,
      o: price,
      h: price,
      l: price,
      c: price,
    });
  }

  /** Current live price for a symbol (the mark). */
  get(symbol: string): number | undefined {
    return this.prices.get(symbol);
  }

  /** Snapshot of all current prices as quotes. */
  quotes(ts: number): Quote[] {
    return [...this.prices.entries()].map(([symbol, price]) => ({
      symbol,
      price,
      ts,
    }));
  }

  /** Retained closed candles for a symbol (for chart backfill on connect). */
  getCandles(symbol: string): Candle[] {
    return this.candles.get(symbol) ?? [];
  }

  /**
   * Record a new price. Returns any candle that CLOSED as a result (i.e. the
   * tick crossed into a new interval bucket), so the caller can broadcast it.
   */
  update(symbol: string, price: number, ts: number): Candle | null {
    this.prices.set(symbol, price);

    const bucket = Math.floor(ts / CANDLE_INTERVAL_MS) * CANDLE_INTERVAL_MS;
    const cur = this.open.get(symbol);

    if (!cur) {
      this.open.set(symbol, { bucket, o: price, h: price, l: price, c: price });
      return null;
    }

    if (bucket === cur.bucket) {
      // Same interval: extend the open candle.
      cur.h = Math.max(cur.h, price);
      cur.l = Math.min(cur.l, price);
      cur.c = price;
      return null;
    }

    // New interval: close the previous candle, retain it, open a fresh one.
    const closed: Candle = {
      symbol,
      o: cur.o,
      h: cur.h,
      l: cur.l,
      c: cur.c,
      ts: cur.bucket,
    };
    const buf = this.candles.get(symbol) ?? [];
    buf.push(closed);
    if (buf.length > CANDLE_BUFFER_SIZE) buf.shift();
    this.candles.set(symbol, buf);

    this.open.set(symbol, { bucket, o: price, h: price, l: price, c: price });
    return closed;
  }
}
