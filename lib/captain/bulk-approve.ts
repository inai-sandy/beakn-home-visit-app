'use server';

import { headers as headersFn } from 'next/headers';

import { getServerSession } from '@/lib/auth-server';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { approveRequest } from '@/lib/captain/approve-request';
import { log } from '@/lib/logger';

// =============================================================================
// 2026-05-26: bulk approve action
// =============================================================================
//
// Per-row transactional but the bulk operation itself is not atomic —
// each request goes through the same `approveRequest` helper the
// single-row route uses. A failure on row N does NOT roll back rows
// 1..N-1; the action returns the success list + per-row failure list
// so the UI can render a partial result.
//
// Justification for partial-success semantics: from the captain's POV,
// approving 10 requests in a session and finding that 1 of them
// changed stage out from under them shouldn't undo the other 9 — those
// approvals are correct and the captain can re-fetch + handle the
// outlier separately.
//
// Bulk size cap = 50 per call. Higher counts spam the audit log and
// the notification engine; rare in practice but still want a guard.
// =============================================================================

const BULK_MAX = 50;
const bulkLog = log.child({ component: 'bulk-approve' });

type ActionResult<T> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export interface BulkApproveInput {
  requestIds: string[];
  note?: string;
}

export interface BulkApproveSummary {
  approved: Array<{ requestId: string; customerName: string }>;
  failures: Array<{ requestId: string; code: string; message: string }>;
}

export async function bulkApproveRequestsAction(
  input: BulkApproveInput,
): Promise<ActionResult<BulkApproveSummary>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string; name?: string };
  if (actor.role !== USER_ROLES.CAPTAIN && actor.role !== USER_ROLES.SUPER_ADMIN) {
    return { ok: false, error: 'Forbidden' };
  }

  const ids = Array.from(new Set(input.requestIds.filter(Boolean)));
  if (ids.length === 0) {
    return { ok: false, error: 'Pick at least one request to approve.' };
  }
  if (ids.length > BULK_MAX) {
    return {
      ok: false,
      error: `Bulk approve is capped at ${BULK_MAX} requests per submit.`,
    };
  }

  const trimmedNote = input.note?.trim();
  const note = trimmedNote && trimmedNote.length > 0 ? trimmedNote : null;

  const reqHeaders = await headersFn();
  const ipAddress =
    reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = reqHeaders.get('user-agent');

  const approved: BulkApproveSummary['approved'] = [];
  const failures: BulkApproveSummary['failures'] = [];

  // Sequential, not parallel — each call writes audit + history rows
  // and the transition service is not designed for N concurrent writes
  // touching different requests. Sequential keeps the surface
  // predictable; bulk caps at 50 so latency stays bounded.
  for (const requestId of ids) {
    const result = await approveRequest({
      requestId,
      actor: {
        userId: actor.id,
        role: actor.role as Role,
        name: actor.name ?? 'A captain',
      },
      note,
      ipAddress,
      userAgent,
    });
    if (result.ok) {
      approved.push({
        requestId: result.requestId,
        customerName: result.customerName,
      });
    } else {
      failures.push({
        requestId,
        code: result.code,
        message: result.message,
      });
    }
  }

  bulkLog.info(
    {
      actorId: actor.id,
      total: ids.length,
      approvedCount: approved.length,
      failureCount: failures.length,
    },
    'bulk_approve_completed',
  );

  return { ok: true, data: { approved, failures } };
}
