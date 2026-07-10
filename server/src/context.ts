// Shared runtime singletons (the price cache + trading engine), created at boot
// in index.ts and injected into routes. Keeps a single in-process source of
// price truth and one engine instance — no globals scattered across modules.

import { PriceCache } from './market/cache.js';
import { TradingEngine } from './trading/engine.js';

export interface AppContext {
  cache: PriceCache;
  engine: TradingEngine;
}

export function createContext(): AppContext {
  const cache = new PriceCache();
  const engine = new TradingEngine(cache);
  return { cache, engine };
}
