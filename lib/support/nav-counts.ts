// =============================================================================
// HVA-231 Phase 2: support portal nav backlog counts (server-only loader)
// =============================================================================
//
// Numeric badges next to the support sidebar / mobile-drawer nav items:
//   - Pending      → line items awaiting first dispatch (mode='pending')
//   - In-progress  → items with >=1 dispatch, not yet fully done
//                    (mode='in_progress')
//   - Orders       → every ORDER_CONFIRMED+ visit_request
//
// Activity has no backlog concept, so it carries no badge.
//
// Counts reuse the EXACT predicates behind the queue pages
// (loadDispatchQueue / loadAllOrders) so a badge "6" matches what the
// support user sees when they click through. We ask for pageSize=1 and
// read `totalCount` — the underlying queries compute totalCount with a
// dedicated COUNT(*) query, so the row payload stays trivially small.
//
// The client-safe `SupportNavCounts` type + `supportNavCountFor` mapping
// live in lib/support/nav.ts (no DB imports) so client components can use
// them without dragging the postgres client into the browser bundle.

import type { SupportNavCounts } from './nav';
import { loadDispatchQueue } from './dispatch-queries';
import { loadAllOrders } from './orders-queries';

export const EMPTY_SUPPORT_NAV_COUNTS: SupportNavCounts = {
  pending: 0,
  inProgress: 0,
  orders: 0,
};

export async function loadSupportNavCounts(): Promise<SupportNavCounts> {
  const [pendingRes, inProgressRes, ordersRes] = await Promise.all([
    loadDispatchQueue({ mode: 'pending', page: 1, pageSize: 1 }),
    loadDispatchQueue({ mode: 'in_progress', page: 1, pageSize: 1 }),
    loadAllOrders({ page: 1, pageSize: 1 }),
  ]);

  return {
    pending: pendingRes.totalCount,
    inProgress: inProgressRes.totalCount,
    orders: ordersRes.totalCount,
  };
}
