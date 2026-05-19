import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { leads, visitRequests } from '@/db/schema';
import { loadCaptainTeamUserIds } from '@/lib/captain/contacts-queries';

// =============================================================================
// HVA-163: captain-side edit auth
// =============================================================================
//
// Two thin gates — one per editable surface on the captain portal —
// mirroring HVA-159's exec helpers but with team-scoped semantics.
// Used by:
//   - editContactAction / editRequestAction (after broadening their role
//     switch to accept captain actors)
//   - /captain/contacts/[contactId] page-level "show the pencil?" check
//   - /requests/[id] page-level pencil-guard for captain viewers
//
// CONTACT — a captain can edit any contact whose captor sits on their
// team. loadCaptainTeamUserIds already filters by users.is_active, so an
// inactive captor's contact naturally falls out of scope.
//
// REQUEST — a captain can edit any request that is either:
//   1. assigned to their team's exec (assigned_exec_user_id ∈ team), or
//   2. routed to them as the assigned captain (assigned_captain_user_id
//      = me) — covers requests that haven't been picked up by an exec
//      yet but the city's owning captain is taking action.
// =============================================================================

export async function canCaptainEditContact(
  captainUserId: string,
  contactId: string,
): Promise<boolean> {
  const [contact] = await db
    .select({ capturedByUserId: leads.capturedByUserId })
    .from(leads)
    .where(eq(leads.id, contactId))
    .limit(1);
  if (!contact) return false;

  const team = await loadCaptainTeamUserIds(captainUserId);
  if (team.length === 0) return false;
  return team.includes(contact.capturedByUserId);
}

export async function canCaptainEditRequest(
  captainUserId: string,
  requestId: string,
): Promise<boolean> {
  const [req] = await db
    .select({
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
    })
    .from(visitRequests)
    .where(eq(visitRequests.id, requestId))
    .limit(1);
  if (!req) return false;

  if (req.assignedCaptainUserId === captainUserId) return true;

  if (req.assignedExecUserId !== null) {
    const team = await loadCaptainTeamUserIds(captainUserId);
    if (team.includes(req.assignedExecUserId)) return true;
  }

  return false;
}
