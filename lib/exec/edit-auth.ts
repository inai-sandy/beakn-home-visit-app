import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requestExecAssignments, tasks, visitRequests } from '@/db/schema';
import { loadExecVisibleContactSet } from '@/lib/exec/visible-contacts';

// =============================================================================
// HVA-159: exec-side edit-auth helpers
// =============================================================================
//
// Three thin gates, one per editable surface. Each returns a plain
// boolean — callers (Server Actions, page-level "show pencil?" decisions)
// invoke them server-side. None of these write; they're pure read auth.
//
// CONTACT — delegates to HVA-161/PR 3's visibility set. If the exec can
// see the contact (captor OR currently-assigned OR historically
// reassigned to/from), they can edit it.
//
// REQUEST — strict D2: (current assignee) OR (a row in
// request_exec_assignments with to_exec_user_id = me). Notably the
// assign route does NOT seed request_exec_assignments on first
// assignment — only the reassign route does — so an original assignee
// who has since been reassigned away cannot edit the request. Per
// Sandeep's explicit call: no contact-captor fallback.
//
// TASK — owner-only and pending-or-postponed-only. Completed and
// cancelled tasks lock down.
// =============================================================================

export type EditAuthResult = { ok: true } | { ok: false; reason: string };

export async function canExecEditContact(
  actorUserId: string,
  contactId: string,
): Promise<boolean> {
  const set = await loadExecVisibleContactSet(actorUserId);
  return set.reasons.has(contactId);
}

export async function canExecEditRequest(
  actorUserId: string,
  requestId: string,
): Promise<boolean> {
  const [req] = await db
    .select({
      assignedExecUserId: visitRequests.assignedExecUserId,
    })
    .from(visitRequests)
    .where(eq(visitRequests.id, requestId))
    .limit(1);

  if (!req) return false;
  if (req.assignedExecUserId === actorUserId) return true;

  const [historical] = await db
    .select({ id: requestExecAssignments.id })
    .from(requestExecAssignments)
    .where(
      and(
        eq(requestExecAssignments.requestId, requestId),
        eq(requestExecAssignments.toExecUserId, actorUserId),
      ),
    )
    .limit(1);

  return Boolean(historical);
}

export async function canExecEditTask(
  actorUserId: string,
  taskId: string,
): Promise<boolean> {
  const [task] = await db
    .select({ execUserId: tasks.execUserId, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!task) return false;
  if (task.execUserId !== actorUserId) return false;
  // Status enum: pending | completed | postponed | cancelled.
  // Completed and cancelled lock the row; postponed is still editable.
  if (task.status === 'completed' || task.status === 'cancelled') return false;
  return true;
}
