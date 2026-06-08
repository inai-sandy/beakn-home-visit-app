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

export const cartplusOrderItemSchema = z.object({
  id: z.number().int(),
  product_id: z.number().int().nullable(),
  name: z.string().min(1).max(500),
  sku: z.string().nullable(),
  unit_price: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  line_total: z.number().nonnegative(),
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
  total_amount: z.number().nonnegative(),
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
