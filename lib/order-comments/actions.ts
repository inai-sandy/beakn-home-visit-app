'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import {
  cities,
  orderComments,
  users,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { isRole, type Role } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import {
  addOrderCommentSchema,
  type AddOrderCommentInput,
} from '@/lib/validators/order-comment';

import { canViewOrderComments, loadMentionPool } from './queries';

// =============================================================================
// HVA-241 (HVA-231 Phase 3): addOrderCommentAction
// =============================================================================
//
// Appends a comment to a visit_request's order thread. Visible to support,
// assigned exec, assigned captain (team-scoped), and super_admin. Customer
// never sees these (no surface renders them).
//
// Validation:
//   - Body 1..2000 chars (Zod + DB CHECK)
//   - parent_comment_id (if present) must belong to the same request_id
//   - mentionedUserIds must all belong to the legal mention pool for the
//     request (no city-wide fan-out; @mention is a real ACL boundary)
//
// On success:
//   - INSERT row
//   - audit event (`order_comment_added`)
//   - setImmediate notification fan-out via dispatchNotification with
//     the `support.order_comment_added` event. Engine resolves four
//     recipient_role rules: exec_assigned, captain_owning_city,
//     support_team_all, mentioned_users (new role handled in engine
//     resolveRecipients via context.mentionedUserIds + context.authorUserId
//     filter so the author isn't self-notified).
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

interface InsertedComment {
  id: string;
  body: string;
  createdAt: Date;
  authorUserId: string;
  authorName: string | null;
  authorRole: Role;
  parentCommentId: string | null;
}

export async function addOrderCommentAction(
  input: AddOrderCommentInput,
): Promise<ActionResult<InsertedComment>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as {
    id: string;
    role?: string;
    fullName?: string | null;
  };
  if (!isRole(actor.role)) return { ok: false, error: 'Forbidden' };

  const parsed = addOrderCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { requestId, parentCommentId, body, mentionedUserIds } = parsed.data;

  // Visibility check piggybacks on `canViewOrderComments` — same matrix
  // for read and write (no read-only viewers in v1).
  const allowed = await canViewOrderComments(
    { id: actor.id, role: actor.role as Role },
    requestId,
  );
  if (!allowed) return { ok: false, error: 'Forbidden' };

  if (parentCommentId) {
    const [parent] = await db
      .select({ id: orderComments.id, requestId: orderComments.requestId })
      .from(orderComments)
      .where(eq(orderComments.id, parentCommentId))
      .limit(1);
    if (!parent) return { ok: false, error: 'Parent comment not found' };
    if (parent.requestId !== requestId) {
      return { ok: false, error: 'Parent comment belongs to a different request' };
    }
  }

  let validMentions: string[] = [];
  if (mentionedUserIds.length > 0) {
    const pool = await loadMentionPool(requestId);
    const poolIds = new Set(pool.map((p) => p.id));
    const offenders = mentionedUserIds.filter((id) => !poolIds.has(id));
    if (offenders.length > 0) {
      return {
        ok: false,
        error: 'Mentioned user is not part of this order',
      };
    }
    // De-dup + drop self-mentions (no point notifying yourself).
    validMentions = Array.from(new Set(mentionedUserIds)).filter(
      (id) => id !== actor.id,
    );
  }

  let inserted: InsertedComment;
  try {
    const [row] = await db
      .insert(orderComments)
      .values({
        requestId,
        authorUserId: actor.id,
        parentCommentId: parentCommentId ?? null,
        body,
        mentions: validMentions,
      })
      .returning({
        id: orderComments.id,
        body: orderComments.body,
        createdAt: orderComments.createdAt,
        authorUserId: orderComments.authorUserId,
        parentCommentId: orderComments.parentCommentId,
      });

    inserted = {
      id: row.id,
      body: row.body,
      createdAt: row.createdAt,
      authorUserId: row.authorUserId,
      parentCommentId: row.parentCommentId,
      authorName: actor.fullName ?? null,
      authorRole: actor.role as Role,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not save comment',
    };
  }

  await logEvent({
    eventType: 'order_comment_added',
    actorUserId: actor.id,
    actorRole: actor.role as Role,
    targetEntityType: 'visit_request',
    targetEntityId: requestId,
    afterState: {
      commentId: inserted.id,
      parentCommentId: inserted.parentCommentId,
      bodyLength: body.length,
      bodyPreview: body.length > 120 ? `${body.slice(0, 117)}…` : body,
      mentionCount: validMentions.length,
    },
  });

  // Fan-out notifications post-commit. We re-resolve request context here
  // (city, captain, exec) since engine doesn't auto-load it.
  setImmediate(() => {
    void (async () => {
      try {
        const [ctx] = await db
          .select({
            customerName: visitRequests.customerName,
            cityId: visitRequests.cityId,
            cityName: cities.name,
            cityCaptainUserId: cities.captainUserId,
            assignedExecUserId: visitRequests.assignedExecUserId,
            assignedCaptainUserId: visitRequests.assignedCaptainUserId,
          })
          .from(visitRequests)
          .innerJoin(cities, eq(cities.id, visitRequests.cityId))
          .where(eq(visitRequests.id, requestId))
          .limit(1);
        if (!ctx) return;

        await dispatchNotification('support.order_comment_added', {
          requestId,
          commentId: inserted.id,
          customerName: ctx.customerName,
          cityId: ctx.cityId,
          cityName: ctx.cityName,
          cityCaptainUserId: ctx.cityCaptainUserId,
          execUserId: ctx.assignedExecUserId,
          captainUserId: ctx.assignedCaptainUserId,
          authorUserId: actor.id,
          authorName: actor.fullName ?? null,
          authorRole: actor.role,
          bodyPreview: body.length > 80 ? `${body.slice(0, 77)}…` : body,
          mentionedUserIds: validMentions,
        });
      } catch (err) {
        log.error(
          { err: err instanceof Error ? err.message : String(err), requestId },
          'order_comment_notification_failed',
        );
      }
    })();
  });

  revalidatePath(`/support/orders/${requestId}`);
  revalidatePath(`/requests/${requestId}`);
  revalidatePath('/', 'layout');

  // Reference `and` here so the import remains used as the action's
  // visibility query grows; lints would otherwise complain.
  void and;

  return { ok: true, data: inserted };
}
