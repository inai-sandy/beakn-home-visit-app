import { isNotNull, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  leads,
  requestExecAssignments,
  visitRequests,
} from '@/db/schema';

// =============================================================================
// HVA-73 PR 3: exec contact visibility set
// =============================================================================
//
// An exec sees a contact when any of these is true:
//
//   1. They captured it: `leads.captured_by_user_id = me`
//   2. They are currently assigned to a request linked to it:
//      `visit_requests.assigned_exec_user_id = me AND contact_id IS NOT NULL`
//   3. They were the to-exec or from-exec on any historical reassignment
//      of a contact-linked request:
//      `request_exec_assignments.{from_exec_user_id|to_exec_user_id} = me`
//      joined back to `visit_requests.contact_id IS NOT NULL`.
//
// Returns a deduplicated array of `leads.id` values. Use it once per
// page render — the three callers below (list, detail, link-pickers)
// each invoke it.
//
// The captor remains the source of truth for the lead row's
// captured_by_user_id — visibility ≠ ownership. Mutations that
// require the captor (addLeadAction on capture) stay narrow;
// `convertLeadToRequestAction` and the `addTaskAction` lead-link
// guard widen to "any visible contact" (PR 3 D1).
//
// Performance posture: at current scale (a few hundred leads / a few
// thousand requests) the union plan runs in single-digit milliseconds.
// PR description carries the EXPLAIN ANALYZE excerpt. If the historical-
// reassignment branch becomes hot, an index on
// `request_exec_assignments.to_exec_user_id` (+ symmetric on from)
// would be the first lever — both columns are uuid FKs so adding btree
// indexes is cheap. Not added today; deferred until prod metrics
// justify it.
// =============================================================================

export interface VisibleContactSet {
  ids: string[];
  /**
   * Map of lead.id → reason the contact is visible. "captor" wins over
   * "assignment" when both are true. Lets the UI render a
   * "Captured by <other exec>" hint when the viewer isn't the captor.
   */
  reasons: Map<string, 'captor' | 'assignment'>;
}

export async function loadExecVisibleContactSet(
  execUserId: string,
): Promise<VisibleContactSet> {
  // Source 1 — captured-by-me leads. Drives the existing "my list" semantics.
  const captorRows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(sql`${leads.capturedByUserId} = ${execUserId}`);

  // Source 2 + 3 — contact_ids reachable via any request I have ever
  // been assigned to (currently OR in the reassignment trail).
  //
  // We could express this as a single union-of-subqueries; in Drizzle
  // it's cleaner as two parallel selects + a JS-side dedup, since the
  // result set is small (bounded by my own assignment volume).
  const currentAssignmentRows = await db
    .select({ contactId: visitRequests.contactId })
    .from(visitRequests)
    .where(
      sql`${visitRequests.assignedExecUserId} = ${execUserId} AND ${visitRequests.contactId} IS NOT NULL`,
    );

  // request_exec_assignments columns: from_exec_user_id (nullable),
  // to_exec_user_id (NOT NULL). I might appear in either when a
  // reassignment moved a request to me or away from me.
  const historicAssignmentRows = await db
    .select({ contactId: visitRequests.contactId })
    .from(requestExecAssignments)
    .innerJoin(
      visitRequests,
      sql`${visitRequests.id} = ${requestExecAssignments.requestId}`,
    )
    .where(
      sql`(${requestExecAssignments.toExecUserId} = ${execUserId}
           OR ${requestExecAssignments.fromExecUserId} = ${execUserId})
          AND ${visitRequests.contactId} IS NOT NULL`,
    );

  const reasons = new Map<string, 'captor' | 'assignment'>();
  for (const r of captorRows) reasons.set(r.id, 'captor');
  for (const r of currentAssignmentRows) {
    if (r.contactId && !reasons.has(r.contactId)) {
      reasons.set(r.contactId, 'assignment');
    }
  }
  for (const r of historicAssignmentRows) {
    if (r.contactId && !reasons.has(r.contactId)) {
      reasons.set(r.contactId, 'assignment');
    }
  }

  return { ids: Array.from(reasons.keys()), reasons };
}

/** Convenience wrapper for callers that only need the id set. */
export async function loadExecVisibleContactIds(
  execUserId: string,
): Promise<string[]> {
  const { ids } = await loadExecVisibleContactSet(execUserId);
  return ids;
}

// Re-export drizzle helpers callers commonly need with the visibility
// set — keeps page-level imports tighter.
export const _drizzleExprs = { or, isNotNull };
