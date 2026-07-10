// Zod schemas for market + trading. These are the single validation contract
// shared by the server (request validation) and the web client (form checks).
// Keep field names aligned with types.ts and the SQL columns (§6/§8/§11).

import { z } from 'zod';

export const OrderSideSchema = z.enum(['buy', 'sell']);
export const OrderTypeSchema = z.enum(['market', 'limit']);
export const OrderSourceSchema = z.enum(['human', 'ai']);
export const OrderStatusSchema = z.enum([
  'pending',
  'filled',
  'rejected',
  'cancelled',
]);

/**
 * Body for placing an order. `limitPrice` is required for limit orders and
 * forbidden for market orders — enforced with a refinement so both the API and
 * the UI reject the same malformed inputs.
 */
export const PlaceOrderSchema = z
  .object({
    symbol: z.string().min(1).max(20),
    side: OrderSideSchema,
    type: OrderTypeSchema,
    quantity: z.number().positive().finite(),
    limitPrice: z.number().positive().finite().optional(),
    source: OrderSourceSchema.optional(), // defaults to 'human' server-side
    reason: z.string().max(2000).optional(),
  })
  .refine((o) => (o.type === 'limit' ? o.limitPrice !== undefined : true), {
    message: 'limitPrice is required for limit orders',
    path: ['limitPrice'],
  })
  .refine((o) => (o.type === 'market' ? o.limitPrice === undefined : true), {
    message: 'limitPrice must be omitted for market orders',
    path: ['limitPrice'],
  });

export type PlaceOrderInput = z.infer<typeof PlaceOrderSchema>;

/** Query params for GET /api/orders. */
export const OrdersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
  status: OrderStatusSchema.optional(),
});

export type OrdersQuery = z.infer<typeof OrdersQuerySchema>;

/** A live quote as streamed/snapshotted (mirrors types.ts Quote). */
export const QuoteSchema = z.object({
  symbol: z.string(),
  price: z.number().positive(),
  ts: z.number().int(),
});
