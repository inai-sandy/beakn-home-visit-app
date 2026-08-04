import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { salesExecutives } from '@/db/schema';

// =============================================================================
// HVA-321: one definition of "this captain owns this request"
// =============================================================================
//
// There were two, and they disagreed.
//
// Page ACCESS (HVA-258, app/requests/[id]/page.tsx) allows a captain in three
// ways: they accepted the request, OR the assigned exec reports to them, OR
// they own the request's city. That last one is kept for the unassigned /
// SUBMITTED routing flow, where no captain has accepted yet.
//
// Action VISIBILITY (computeActionVisibility) and every /api/requests/[id]/*
// route checked only the third — `cities.captain_user_id === me`. So a captain
// who reached the page through either of the other two paths saw the request
// and no buttons at all: no rollback, no reassign, no reject, no approve.
//
// That is the "it was there before, now it's gone" report, and it is the same
// split-brain shape as HVA-310: a rule expressed twice, in two places, that
// nothing forced to agree.
//
// This is now the single predicate. The page uses it for the access gate AND
// feeds the result to the visibility helper; the routes use it for their
// per-row authorization. Widening the UI without the routes would just move
// the failure from an invisible button to a 403 on click.
// =============================================================================

export interface CaptainScopeRow {
  /** visit_requests.assigned_captain_user_id — the captain who accepted it. */
  assignedCaptainUserId: string | null;
  /** cities.captain_user_id for the request's city. */
  cityCaptainUserId: string | null;
  /** visit_requests.assigned_exec_user_id. */
  assignedExecUserId: string | null;
}

/**
 * Whether `captainUserId` may see and act on this request.
 *
 * Deliberately identical to the HVA-258 page-access rule: authority to act
 * must not be narrower than authority to view, or the captain gets a page
 * they cannot use.
 *
 * Runs a team lookup only when the cheap checks miss.
 */
export async function captainOwnsRequest(
  row: CaptainScopeRow,
  captainUserId: string,
): Promise<boolean> {
  if (row.assignedCaptainUserId === captainUserId) return true;
  if (row.cityCaptainUserId === captainUserId) return true;
  if (!row.assignedExecUserId) return false;

  const [teamRow] = await db
    .select({ userId: salesExecutives.userId })
    .from(salesExecutives)
    .where(
      and(
        eq(salesExecutives.userId, row.assignedExecUserId),
        eq(salesExecutives.captainUserId, captainUserId),
      ),
    )
    .limit(1);
  return Boolean(teamRow);
}
