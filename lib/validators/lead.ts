import { z } from 'zod';

// Lead capture form (Customer or Business).
// Filled by HVA-73 (Leads section: unified form fields, business_type FK).

export const leadSchema = z.object({});

export type LeadInput = z.infer<typeof leadSchema>;
