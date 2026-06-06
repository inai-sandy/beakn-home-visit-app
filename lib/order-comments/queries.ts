import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { orderComments, users, visitRequests } from '@/db/schema';
import type { Role } from '@/lib/auth/roles';
import { USER_ROLES } from '@/lib/auth/roles';
import { loadCaptainTeamUserIds } from '@/lib/captain/contacts-queries';

// =============================================================================
// HVA-241 (HVA-231 Phase 3): order_comments queries + visibility
// =============================================================================
//
// `canViewOrderComments` mirrors the Phase 2 viewer matrix:
//   - super_admin  → always
//   - support      → always (queue is global)
//   - sales_executive → if assigned to the request
//   - captain      → if assigned to the request OR captain of the assigned exec
// Customer never sees these.
//
// `loadCommentsForRequest` returns the timeline rows joined with author
// metadata (name + role) so the UI doesn't need a per-comment lookup.
// =============================================================================

export interface OrderCommentRow {
  id: string;
  body: string;
  parentCommentId: string | null;
  mentions: string[];
  createdAt: Date;
  authorUserId: string;
  authorName: string | null;
  authorRole: Role;
}

export async function canViewOrderComments(
  viewer: { id: string; role: Role },
  requestId: string,
): Promise<boolean> {
  if (viewer.role === USER_ROLES.SUPER_ADMIN) return true;
  if (viewer.role === USER_ROLES.SUPPORT) return true;

  const [req] = await db
    .select({
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
    })
    .from(visitRequests)
    .where(eq(visitRequests.id, requestId))
    .limit(1);
  if (!req) return false;

  if (viewer.role === USER_ROLES.SALES_EXECUTIVE) {
    return req.assignedExecUserId === viewer.id;
  }

  if (viewer.role === USER_ROLES.CAPTAIN) {
    if (req.assignedCaptainUserId === viewer.id) return true;
    if (req.assignedExecUserId !== null) {
      const team = await loadCaptainTeamUserIds(viewer.id);
      return team.includes(req.assignedExecUserId);
    }
  }

  return false;
}

export async function loadCommentsForRequest(
  requestId: string,
): Promise<OrderCommentRow[]> {
  const rows = await db
    .select({
      id: orderComments.id,
      body: orderComments.body,
      parentCommentId: orderComments.parentCommentId,
      mentions: orderComments.mentions,
      createdAt: orderComments.createdAt,
      authorUserId: orderComments.authorUserId,
      authorName: users.fullName,
      authorRole: users.role,
    })
    .from(orderComments)
    .innerJoin(users, eq(users.id, orderComments.authorUserId))
    .where(eq(orderComments.requestId, requestId))
    .orderBy(asc(orderComments.createdAt));

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    parentCommentId: r.parentCommentId,
    mentions: Array.isArray(r.mentions) ? (r.mentions as string[]) : [],
    createdAt: r.createdAt,
    authorUserId: r.authorUserId,
    authorName: r.authorName ?? null,
    authorRole: r.authorRole as Role,
  }));
}

/**
 * Resolve the @mention picker pool for a given request: the assigned exec,
 * the assigned captain, all active support users, and all active super_admins.
 * Used by the UI to show the picker dropdown and by the action to validate
 * mentionedUserIds belong to the legal pool (no city-wide fan-out).
 */
export async function loadMentionPool(
  requestId: string,
): Promise<{ id: string; fullName: string | null; role: Role }[]> {
  const [req] = await db
    .select({
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
    })
    .from(visitRequests)
    .where(eq(visitRequests.id, requestId))
    .limit(1);
  if (!req) return [];

  // Always pool support + super_admin.
  const supportAdmin = await db
    .select({ id: users.id, fullName: users.fullName, role: users.role })
    .from(users)
    .where(and(inArray(users.role, ['support', 'super_admin']), eq(users.isActive, true)));

  const extraIds = [req.assignedExecUserId, req.assignedCaptainUserId].filter(
    (id): id is string => typeof id === 'string',
  );
  const extras = extraIds.length
    ? await db
        .select({ id: users.id, fullName: users.fullName, role: users.role })
        .from(users)
        .where(and(inArray(users.id, extraIds), eq(users.isActive, true)))
    : [];

  // De-dup by id (assigned exec/captain might also be in support pool one day).
  const seen = new Set<string>();
  const out: { id: string; fullName: string | null; role: Role }[] = [];
  for (const row of [...supportAdmin, ...extras]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, fullName: row.fullName ?? null, role: row.role as Role });
  }
  return out;
}
