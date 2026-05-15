import { z } from 'zod';

// Payment recording form (amount paise, date, mode, reference number).
// Filled by HVA-70 (Collection tab on request).

export const paymentSchema = z.object({});

export type PaymentInput = z.infer<typeof paymentSchema>;
