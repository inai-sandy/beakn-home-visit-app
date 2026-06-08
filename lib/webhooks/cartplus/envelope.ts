import { z } from 'zod';

// =============================================================================
// HVA-249 (HVA-230): CartPlus webhook envelope schema
// =============================================================================
//
// Validates ONLY the outer envelope so HVA-249 can extract id / type /
// store.id without coupling to per-event payload shapes. Detailed `data`
// validation lives with the per-event handlers in HVA-250 / HVA-251.
//
// Reference: README_Webhook.pdf (CartPlus partner doc, 2026-06-07).
// =============================================================================

export const CARTPLUS_PROVIDER = 'cartplus';

/** Events HVA subscribes to in v1 (HVA-230 lock). */
export const SUPPORTED_EVENT_TYPES = [
  'order.created',
  'order.status_changed',
  'order.cancelled',
] as const;

export type CartplusEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

export const cartplusEnvelopeSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(100),
  store: z.object({
    id: z.number().int().positive(),
    slug: z.string(),
    name: z.string(),
  }),
  // Event-specific payload validated downstream by per-handler schemas.
  data: z.unknown(),
  created_at: z.string(),
  test: z.boolean().optional(),
});

export type CartplusEnvelope = z.infer<typeof cartplusEnvelopeSchema>;
