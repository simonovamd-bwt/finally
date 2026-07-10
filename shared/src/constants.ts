// Shared constants: the seed instrument universe and simulation defaults.
// The server seeds the database from SEED_INSTRUMENTS on first run.

import type { Instrument } from './types.js';

/** Seed instruments (start prices/vols are plausible but arbitrary — this is a sim). */
export const SEED_INSTRUMENTS: Omit<Instrument, 'createdAt'>[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', startPrice: 212.5, volatility: 0.28 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', startPrice: 458.2, volatility: 0.26 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', startPrice: 128.4, volatility: 0.5 },
  { symbol: 'TSLA', name: 'Tesla Inc.', startPrice: 246.9, volatility: 0.55 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', startPrice: 198.7, volatility: 0.32 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', startPrice: 179.3, volatility: 0.3 },
  { symbol: 'META', name: 'Meta Platforms Inc.', startPrice: 512.6, volatility: 0.35 },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', startPrice: 548.1, volatility: 0.16 },
  { symbol: 'BTC-USD', name: 'Bitcoin', startPrice: 61250.0, volatility: 0.7 },
];

/** Default trading fee applied per fill (flat, for simplicity). */
export const DEFAULT_FEE = 0;

/** Number of in-memory candles the simulator retains per symbol. */
export const CANDLE_BUFFER_SIZE = 300;

/** SSE heartbeat interval (ms) to keep idle connections alive. */
export const SSE_HEARTBEAT_MS = 15_000;

/** Service metadata. */
export const SERVICE_NAME = 'finally';
export const SERVICE_VERSION = '0.1.0';
