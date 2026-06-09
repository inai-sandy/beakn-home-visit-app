import { z } from 'zod';

// =============================================================================
// HVA-250 (HVA-230): Zod schema for the order.* payload `data.order` field
// =============================================================================
//
// Reference: CartPlus webhook spec §4 (README_Webhook.pdf).
//
// Only the fields HVA actually consumes are required here. Anything the
// partner adds later just passes through as raw_payload on the quotation
// row, no code change needed.
// =============================================================================

// HVA-259: money fields arrive as rupee decimals and get converted to
// paise via Math.round(x * 100). A malformed amount with >2 decimal
// places (e.g. 123.456) would silently round instead of being rejected
// — violating the paise-integer invariant at the validation boundary.
// EPSILON soaks float representation noise (1234.56 * 100 =
// 123455.99999999999 must still pass).
const rupeeAmount = z
  .number()
  .nonnegative()
  .refine(
    (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6,
    'amount must have at most 2 decimal places',
  );

export const cartplusOrderItemSchema = z.object({
  id: z.number().int(),
  product_id: z.number().int().nullable(),
  name: z.string().min(1).max(500),
  sku: z.string().nullable(),
  unit_price: rupeeAmount,
  quantity: z.number().int().positive(),
  line_total: rupeeAmount,
  notes: z.string().nullable().optional(),
});

export const cartplusOrderCustomerSchema = z.object({
  id: z.number().int().nullable().optional(),
  name: z.string().min(1).max(255),
  phone: z.string().min(1).max(20),
  email: z.string().nullable().optional(),
});

export const cartplusOrderCreatedBySchema = z
  .object({
    id: z.number().int(),
    name: z.string().min(1).max(255),
    email: z.string().nullable().optional(),
  })
  .nullable();

export const cartplusOrderSchema = z.object({
  id: z.number().int(),
  order_number: z.string().min(1).max(100),
  status: z.string(),
  payment_status: z.string(),
  fulfillment_status: z.string(),
  currency: z.string(),
  total_amount: rupeeAmount,
  placed_at: z.string().nullable(),
  items: z.array(cartplusOrderItemSchema).min(1),
  created_by: cartplusOrderCreatedBySchema,
  customer: cartplusOrderCustomerSchema,
});

export const cartplusOrderEventDataSchema = z.object({
  order: cartplusOrderSchema,
});

export type CartplusOrder = z.infer<typeof cartplusOrderSchema>;
export type CartplusOrderItem = z.infer<typeof cartplusOrderItemSchema>;
export type CartplusOrderCustomer = z.infer<typeof cartplusOrderCustomerSchema>;
