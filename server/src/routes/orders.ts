// Order routes (plan §8/§11). POST /api/orders places an order through the
// engine (same path for human + AI); GET /api/orders returns recent history.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  OrdersQuerySchema,
  PlaceOrderSchema,
  type Fill,
  type Order,
} from '@finally/shared';
import type { AppContext } from '../context.js';
import { getFills, getOrders } from '../db/queries.js';
import { OrderRejectedError } from '../trading/engine.js';

export function orderRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance): Promise<void> {
    app.post(
      '/api/orders',
      async (
        req: FastifyRequest,
        reply: FastifyReply,
      ): Promise<{ order: Order; fill: Fill | null } | { error: string }> => {
        const parsed = PlaceOrderSchema.safeParse(req.body);
        if (!parsed.success) {
          reply.code(400);
          return { error: parsed.error.issues[0]?.message ?? 'invalid order' };
        }
        try {
          return ctx.engine.submitOrder(parsed.data);
        } catch (err) {
          if (err instanceof OrderRejectedError) {
            reply.code(422);
            return { error: err.message };
          }
          throw err;
        }
      },
    );

    app.get(
      '/api/orders',
      async (req: FastifyRequest): Promise<{ orders: Order[]; fills: Fill[] }> => {
        const q = OrdersQuerySchema.parse(req.query);
        return {
          orders: getOrders(q.limit, q.status),
          fills: getFills(q.limit),
        };
      },
    );
  };
}
