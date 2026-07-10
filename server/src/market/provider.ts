// Market data provider interface + factory. A single env var (MASSIVE_API_KEY)
// selects the source once at startup, behind one interface (plan §7/§20.2):
//   empty  → GBM SimulatorProvider (default, fully self-contained)
//   set    → MassiveProvider (real Polygon/Massive quotes)
// SSE, the price cache, and the frontend stay source-agnostic. Both run
// in-process in the same single container — never a separate service.

import { config } from '../config.js';
import type { PriceCache } from './cache.js';

/** Every provider writes ticks into the shared PriceCache on its own cadence. */
export interface MarketDataProvider {
  readonly name: string;
  /** Begin producing prices (starts the interval / poller). */
  start(): void;
  /** Stop producing prices (clears the interval / poller) for graceful shutdown. */
  stop(): void;
}

/**
 * Called once during boot. Returns the real-data provider when a key is
 * present, otherwise the simulator. Kept as a dynamic import chain so the
 * simulator has no dependency on the Massive client and vice-versa.
 */
export async function createMarketDataProvider(
  cache: PriceCache,
): Promise<MarketDataProvider> {
  const apiKey = (config.MASSIVE_API_KEY ?? '').trim();
  if (apiKey) {
    const { MassiveProvider } = await import('./massive.js');
    return new MassiveProvider(cache, apiKey);
  }
  const { SimulatorProvider } = await import('./simulator.js');
  return new SimulatorProvider(cache);
}
