import { z } from 'zod';

// Customer-side visit request submission form.
// Filled by HVA-31 (customer form fields) + HVA-33 (server-side validation).
// Today: empty placeholder so downstream issues can land schema diffs without
// also having to invent the file path / export shape.

export const customerRequestSchema = z.object({});

export type CustomerRequestInput = z.infer<typeof customerRequestSchema>;
