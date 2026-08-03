// =============================================================================
// HVA-65: shared request-row type for captain + exec list pages
// =============================================================================
//
// One TypeScript shape lets both pages pass results to the same render
// primitives (`RequestsTable`, `RequestCardMobile`). Captain mode reads
// `assignedExecName`; exec mode ignores it. Optional fields exist so an
// exec query can omit `assignedExecName` (it's always the current exec
// anyway).
// =============================================================================

import type { OrderDispatchSummary } from '@/lib/dispatch/fulfilment';

export interface RequestRow {
  id: string;
  customerName: string;
  customerPhone: string;
  cityName: string;
  statusCode: string;
  statusName: string;
  /** HVA-305: stage sequence, used to decide whether dispatch state is
   *  meaningful yet (>= 6 / ORDER_CONFIRMED). Sequence rather than a code
   *  list — see isDispatchVisible. */
  statusSequence: number;
  /** HVA-305: order-level dispatch roll-up. Null before ORDER_CONFIRMED,
   *  or when the order has no line items — no pill is rendered then. */
  dispatch?: OrderDispatchSummary | null;
  assignedExecUserId: string | null;
  /** Captain-mode only. Exec-mode pages pass null/undefined and the column is hidden. */
  assignedExecName?: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export type RequestsViewMode = 'captain' | 'exec';
