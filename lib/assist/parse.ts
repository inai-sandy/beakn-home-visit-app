// HVA-199: tiny pure helpers used by route handlers + queries to validate
// searchParams + raw strings against the enums without importing the
// Drizzle schema (keeps these usable from client components if needed).

import type { AssistPriority, AssistStatus, AssistType } from './types';

const TYPES = ['material_request'] as const satisfies readonly AssistType[];
const STATUSES = [
  'submitted',
  'approved',
  'processing',
  'dispatched',
  'rejected',
] as const satisfies readonly AssistStatus[];
const PRIORITIES = ['high', 'medium', 'low'] as const satisfies readonly AssistPriority[];

export function isAssistType(v: unknown): v is AssistType {
  return typeof v === 'string' && (TYPES as readonly string[]).includes(v);
}

export function isAssistStatus(v: unknown): v is AssistStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

export function isAssistPriority(v: unknown): v is AssistPriority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
}
