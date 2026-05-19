import { and, desc, eq, inArray, or } from 'drizzle-orm';

import { db } from '@/db/client';
import { leads, notes, users, visitRequests } from '@/db/schema';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { loadCaptainTeamUserIds } from '@/lib/captain/contacts-queries';
import {
  canExecEditContact,
  canExecEditRequest,
} from '@/lib/exec/edit-auth';

import type { NoteRow, NoteTarget } from './types';

export type { NoteRow, NoteTarget };
export { roleLabel } from './types';

// =============================================================================
// HVA-73 PR 2 + PR 3: notes read + write-auth helpers
// =============================================================================
//
// Notes table (db/schema/notes.ts) is polymorphic over target_type:
//   'request' → target_id → visit_requests.id
//   'contact' → target_id → leads.id
//
// Read auth is delegated to the calling page (if the page can render the
// detail, the user can read its notes — same fact-of-the-matter we use
// for every other field on those pages).
//
// Write auth (D2 / D4) is enforced here:
//   - sales_executive: must satisfy the HVA-159 edit-auth helper for the
//     entity type (canExecEditContact / canExecEditRequest).
//   - captain: write on anything in their team. For a request, that
//     means assigned_exec_user_id ∈ team OR assigned_captain_user_id =
//     currentCaptain. For a contact, captured_by_user_id ∈ team.
//   - super_admin: always allowed.
// =============================================================================

export interface ActorForNotes {
  id: string;
  role: Role;
}

export async function loadNotesForEntity(
  targetType: NoteTarget,
  targetId: string,
): Promise<NoteRow[]> {
  const rows = await db
    .select({
      id: notes.id,
      body: notes.body,
      createdAt: notes.createdAt,
      authorUserId: notes.createdByUserId,
      authorName: users.fullName,
      authorRole: users.role,
    })
    .from(notes)
    .innerJoin(users, eq(users.id, notes.createdByUserId))
    .where(
      and(eq(notes.targetType, targetType), eq(notes.targetId, targetId)),
    )
    .orderBy(desc(notes.createdAt));

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    createdAt: r.createdAt,
    authorUserId: r.authorUserId,
    authorName: r.authorName,
    authorRole: r.authorRole as Role,
  }));
}

/**
 * Auth gate for `addNoteAction`. Centralised so the Server Action and
 * the page-level "show the textarea?" check stay in lockstep.
 */
export async function canWriteNoteForEntity(
  actor: ActorForNotes,
  targetType: NoteTarget,
  targetId: string,
): Promise<boolean> {
  if (actor.role === USER_ROLES.SUPER_ADMIN) return true;

  if (actor.role === USER_ROLES.SALES_EXECUTIVE) {
    if (targetType === 'request') {
      return canExecEditRequest(actor.id, targetId);
    }
    return canExecEditContact(actor.id, targetId);
  }

  if (actor.role === USER_ROLES.CAPTAIN) {
    // Team-scope write per D4: a captain can write on anything in their
    // team. team = sales_executives.user_id where captain_user_id = me.
    const teamIds = await loadCaptainTeamUserIds(actor.id);
    if (teamIds.length === 0) return false;

    if (targetType === 'request') {
      // Request belongs to this captain's team when its assigned exec
      // sits on the team OR the captain is the assigned captain (covers
      // unassigned requests they routed themselves).
      const [row] = await db
        .select({
          assignedExecUserId: visitRequests.assignedExecUserId,
          assignedCaptainUserId: visitRequests.assignedCaptainUserId,
        })
        .from(visitRequests)
        .where(eq(visitRequests.id, targetId))
        .limit(1);
      if (!row) return false;
      if (row.assignedCaptainUserId === actor.id) return true;
      if (
        row.assignedExecUserId !== null &&
        teamIds.includes(row.assignedExecUserId)
      ) {
        return true;
      }
      return false;
    }

    // contact: captor must sit on the captain's team.
    const [contact] = await db
      .select({ capturedByUserId: leads.capturedByUserId })
      .from(leads)
      .where(eq(leads.id, targetId))
      .limit(1);
    if (!contact) return false;
    return teamIds.includes(contact.capturedByUserId);
  }

  return false;
}

// Re-exports to keep call sites tighter on the page layer.
export { canExecEditContact, canExecEditRequest };
export { inArray, or };
