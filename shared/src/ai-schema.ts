// The structured-output contract for the AI co-pilot.
// Fully fleshed out in the AI milestone (plan §10); stubbed here so both
// server and web can import a stable shape from day one.

import { z } from 'zod';

/** Non-mutating analysis of the portfolio / market. */
export const AnalysisSchema = z.object({
  kind: z.literal('analysis'),
  summary: z.string(),
  observations: z.array(z.string()).default([]),
  riskFlags: z.array(z.string()).default([]),
});

/** A concrete order the LLM proposes; the engine re-validates before any fill. */
export const OrderProposalSchema = z.object({
  kind: z.literal('order_proposal'),
  rationale: z.string(),
  orders: z
    .array(
      z.object({
        symbol: z.string(),
        side: z.enum(['buy', 'sell']),
        type: z.enum(['market', 'limit']),
        quantity: z.number().positive(),
        limitPrice: z.number().positive().optional(),
      }),
    )
    .min(1),
});

/** The co-pilot returns exactly one of these variants. */
export const CoPilotResponseSchema = z.discriminatedUnion('kind', [
  AnalysisSchema,
  OrderProposalSchema,
]);

export type Analysis = z.infer<typeof AnalysisSchema>;
export type OrderProposal = z.infer<typeof OrderProposalSchema>;
export type CoPilotResponse = z.infer<typeof CoPilotResponseSchema>;
