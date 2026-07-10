// Core domain types shared by the server and the web client.
// These are the single source of truth for API and SSE payload shapes.

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'filled' | 'rejected' | 'cancelled';
export type OrderSource = 'human' | 'ai';

/** A tradable instrument in the simulated universe. */
export interface Instrument {
  symbol: string;
  name: string;
  startPrice: number;
  volatility: number; // annualized, drives the GBM step
  createdAt: number; // epoch ms
}

/** A point-in-time price snapshot streamed from the simulator. */
export interface Quote {
  symbol: string;
  price: number;
  ts: number; // epoch ms
}

/** A single OHLC candle for the chart. */
export interface Candle {
  symbol: string;
  o: number;
  h: number;
  l: number;
  c: number;
  ts: number; // epoch ms (candle open time)
}

/** A held position (signed quantity; negative = short). */
export interface Position {
  symbol: string;
  quantity: number;
  avgPrice: number; // cost basis
  updatedAt: number;
}

/** A position enriched with live mark + P&L for display. */
export interface PositionView extends Position {
  mark: number; // current simulated price
  marketValue: number; // quantity * mark
  unrealizedPnl: number; // (mark - avgPrice) * quantity
}

/** An order as stored and returned by the API. */
export interface Order {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice: number | null;
  status: OrderStatus;
  source: OrderSource;
  reason: string | null; // AI rationale, if source === 'ai'
  createdAt: number;
  updatedAt: number;
}

/** An execution against an order. */
export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  fee: number;
  createdAt: number;
}

/** The full portfolio read model. */
export interface Portfolio {
  cash: number;
  positions: PositionView[];
  equity: number; // cash + sum(marketValue)
  unrealizedPnl: number;
  updatedAt: number;
}

/** Request body for placing an order. */
export interface PlaceOrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  limitPrice?: number;
  source?: OrderSource; // defaults to 'human'
  reason?: string;
}

/** A chat message in the co-pilot transcript. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

/** Server health payload. */
export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  uptimeMs: number;
  ts: number;
}

// ── SSE event payloads ────────────────────────────────
export type StreamEvent =
  | { type: 'quote'; data: Quote[] }
  | { type: 'candle'; data: Candle }
  | { type: 'fill'; data: Fill }
  | { type: 'portfolio'; data: Portfolio };
