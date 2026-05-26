'use server';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { adminHelpMessages, users, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { sendEmail } from '@/lib/email';

// =============================================================================
// HVA-77 + HVA-94: Admin Help round-trip
// =============================================================================
//
// Exec sends a per-appointment help message → admin sees it in their inbox
// → admin replies once (reply-once semantics per spec §7) → exec sees the
// reply on the request detail. Email notification on both legs.
//
// In-app notification badge (3C-lite): admin sidebar's "Admin Help Inbox"
// item shows a count derived directly from the admin_help_messages table
// (`replied_at IS NULL`) — no notification engine required.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 500;
const REPLY_MIN = 10;
const REPLY_MAX = 500;

const sendHelpSchema = z.object({
  requestId: z.string().uuid(),
  message: z
    .string()
    .trim()
    .min(MESSAGE_MIN, `Message must be at least ${MESSAGE_MIN} characters`)
    .max(MESSAGE_MAX, `Message must be ${MESSAGE_MAX} characters or fewer`),
});

const replyHelpSchema = z.object({
  messageId: z.string().uuid(),
  reply: z
    .string()
    .trim()
    .min(REPLY_MIN, `Reply must be at least ${REPLY_MIN} characters`)
    .max(REPLY_MAX, `Reply must be ${REPLY_MAX} characters or fewer`),
});

export type SendAdminHelpInput = z.infer<typeof sendHelpSchema>;
export type ReplyAdminHelpInput = z.infer<typeof replyHelpSchema>;

// -----------------------------------------------------------------------------
// Sales exec — send
// -----------------------------------------------------------------------------

export async function sendAdminHelpAction(
  input: SendAdminHelpInput,
): Promise<ActionResult<{ messageId: string }>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (actor.role !== USER_ROLES.SALES_EXECUTIVE) {
    return { ok: false, error: 'Only sales executives can send admin help' };
  }

  const parsed = sendHelpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  // Exec must be assigned to this request.
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      assignedExecUserId: visitRequests.assignedExecUserId,
      customerName: visitRequests.customerName,
    })
    .from(visitRequests)
    .where(eq(visitRequests.id, data.requestId))
    .limit(1);
  if (!reqRow) return { ok: false, error: 'Request not found' };
  if (reqRow.assignedExecUserId !== actor.id) {
    return {
      ok: false,
      error: 'You are not assigned to this request',
    };
  }

  const [inserted] = await db
    .insert(adminHelpMessages)
    .values({
      requestId: data.requestId,
      execUserId: actor.id,
      message: data.message,
    })
    .returning({ id: adminHelpMessages.id });

  await logEvent({
    eventType: 'admin_help_sent',
    actorUserId: actor.id,
    actorRole: 'sales_executive',
    targetEntityType: 'admin_help_message',
    targetEntityId: inserted.id,
    afterState: {
      requestId: data.requestId,
      messageLength: data.message.length,
    },
  });

  // Fire-and-forget email to all super_admins. We don't store admin
  // emails per-user in a separate config; rely on users.role='super_admin'.
  void notifyAdminsOfNewHelpMessage({
    requestId: data.requestId,
    customerName: reqRow.customerName,
    message: data.message,
    execUserId: actor.id,
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { messageId: inserted.id } };
}

// -----------------------------------------------------------------------------
// Admin — reply
// -----------------------------------------------------------------------------

export async function replyAdminHelpAction(
  input: ReplyAdminHelpInput,
): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (actor.role !== USER_ROLES.SUPER_ADMIN) {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = replyHelpSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  const [row] = await db
    .select({
      id: adminHelpMessages.id,
      execUserId: adminHelpMessages.execUserId,
      requestId: adminHelpMessages.requestId,
      message: adminHelpMessages.message,
      repliedAt: adminHelpMessages.repliedAt,
    })
    .from(adminHelpMessages)
    .where(eq(adminHelpMessages.id, data.messageId))
    .limit(1);
  if (!row) return { ok: false, error: 'Message not found' };
  if (row.repliedAt !== null) {
    return { ok: false, error: 'Message has already been replied to' };
  }

  const now = new Date();
  await db
    .update(adminHelpMessages)
    .set({
      repliedMessage: data.reply,
      repliedAt: now,
      repliedByAdminId: actor.id,
    })
    .where(eq(adminHelpMessages.id, data.messageId));

  await logEvent({
    eventType: 'admin_help_replied',
    actorUserId: actor.id,
    actorRole: 'super_admin',
    targetEntityType: 'admin_help_message',
    targetEntityId: data.messageId,
    afterState: {
      replyLength: data.reply.length,
      replyAt: now.toISOString(),
    },
  });

  // Email the exec.
  void notifyExecOfHelpReply({
    execUserId: row.execUserId,
    requestId: row.requestId,
    originalMessage: row.message,
    reply: data.reply,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Query helpers
// -----------------------------------------------------------------------------

export async function loadAdminHelpForRequest(requestId: string) {
  return db
    .select({
      id: adminHelpMessages.id,
      message: adminHelpMessages.message,
      sentAt: adminHelpMessages.sentAt,
      repliedMessage: adminHelpMessages.repliedMessage,
      repliedAt: adminHelpMessages.repliedAt,
    })
    .from(adminHelpMessages)
    .where(eq(adminHelpMessages.requestId, requestId))
    .orderBy(desc(adminHelpMessages.sentAt));
}

export interface AdminHelpInboxRow {
  id: string;
  message: string;
  sentAt: Date;
  repliedMessage: string | null;
  repliedAt: Date | null;
  execName: string | null;
  customerName: string;
  requestId: string;
}

export type AdminHelpDateFilter = 'today' | 'week' | 'month' | 'all';

function dateFilterToSinceISO(filter: AdminHelpDateFilter): string | null {
  const now = new Date();
  if (filter === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (filter === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }
  if (filter === 'month') {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d.toISOString();
  }
  return null;
}

/**
 * Paginated + searchable + date-filtered inbox. Date filter chips along
 * the top of the inbox UI pick a sliding-window time range; search box
 * matches the message text + exec name + customer name.
 */
export async function loadAdminHelpInbox(args: {
  page?: number;
  pageSize?: number;
  search?: string;
  dateFilter?: AdminHelpDateFilter;
}): Promise<{ rows: AdminHelpInboxRow[]; total: number }> {
  const term = args.search?.trim().toLowerCase() ?? '';
  const since = dateFilterToSinceISO(args.dateFilter ?? 'all');

  const whereConditions: ReturnType<typeof and>[] = [];
  if (term.length > 0) {
    whereConditions.push(
      sql`(LOWER(${adminHelpMessages.message}) LIKE ${`%${term}%`}
          OR LOWER(${users.fullName}) LIKE ${`%${term}%`}
          OR LOWER(${visitRequests.customerName}) LIKE ${`%${term}%`})`,
    );
  }
  if (since) {
    whereConditions.push(sql`${adminHelpMessages.sentAt} >= ${since}`);
  }
  const where = whereConditions.length > 0 ? and(...whereConditions) : undefined;

  const baseQuery = db
    .select({
      id: adminHelpMessages.id,
      message: adminHelpMessages.message,
      sentAt: adminHelpMessages.sentAt,
      repliedMessage: adminHelpMessages.repliedMessage,
      repliedAt: adminHelpMessages.repliedAt,
      execName: users.fullName,
      customerName: visitRequests.customerName,
      requestId: visitRequests.id,
    })
    .from(adminHelpMessages)
    .innerJoin(users, eq(users.id, adminHelpMessages.execUserId))
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, adminHelpMessages.requestId),
    );

  const countQuery = db
    .select({ total: sql<number>`COUNT(*)::int` })
    .from(adminHelpMessages)
    .innerJoin(users, eq(users.id, adminHelpMessages.execUserId))
    .innerJoin(
      visitRequests,
      eq(visitRequests.id, adminHelpMessages.requestId),
    );

  const pageSize = args.pageSize ?? 20;
  const page = Math.max(1, args.page ?? 1);
  const offset = (page - 1) * pageSize;

  const [rows, totalResult] = await Promise.all([
    (where ? baseQuery.where(where) : baseQuery)
      .orderBy(
        sql`(${adminHelpMessages.repliedAt} IS NULL)::int DESC`,
        desc(adminHelpMessages.sentAt),
      )
      .limit(pageSize)
      .offset(offset),
    where ? countQuery.where(where) : countQuery,
  ]);

  return { rows, total: totalResult[0]?.total ?? 0 };
}

/** Drives the admin sidebar "Admin Help Inbox" badge (3C-lite, no engine). */
export async function countPendingAdminHelpMessages(): Promise<number> {
  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(adminHelpMessages)
    .where(isNull(adminHelpMessages.repliedAt));
  return row?.cnt ?? 0;
}

// -----------------------------------------------------------------------------
// Email composers (inline; tiny enough to avoid a separate file)
// -----------------------------------------------------------------------------

async function notifyAdminsOfNewHelpMessage(args: {
  requestId: string;
  customerName: string;
  message: string;
  execUserId: string;
}): Promise<void> {
  const recipients = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, 'super_admin'), eq(users.isActive, true)));
  const to = recipients
    .map((r) => r.email)
    .filter((e): e is string => Boolean(e));
  if (to.length === 0) return;

  const [exec] = await db
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, args.execUserId))
    .limit(1);

  const link = `https://visits.beakn.in/admin/operations/admin-help`;
  await sendEmail({
    to: to[0]!,
    bcc: to.slice(1),
    subject: `Admin help requested — ${args.customerName}`,
    text: `${exec?.fullName ?? 'A sales executive'} sent an admin help message on the request for ${args.customerName}:\n\n"${args.message}"\n\nReply in the admin inbox:\n${link}`,
    html: `<p><strong>${exec?.fullName ?? 'A sales executive'}</strong> sent an admin help message on the request for <strong>${args.customerName}</strong>:</p><blockquote>${escapeHtml(args.message)}</blockquote><p><a href="${link}">Reply in the admin inbox</a></p>`,
    templateName: 'admin_help_sent',
  });
}

async function notifyExecOfHelpReply(args: {
  execUserId: string;
  requestId: string;
  originalMessage: string;
  reply: string;
}): Promise<void> {
  const [exec] = await db
    .select({ email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, args.execUserId))
    .limit(1);
  if (!exec?.email) return;

  const link = `https://visits.beakn.in/requests/${args.requestId}`;
  await sendEmail({
    to: exec.email,
    subject: `Admin replied to your help message`,
    text: `Hi ${exec.fullName ?? 'there'},\n\nAdmin replied to your help message:\n\nYour question:\n"${args.originalMessage}"\n\nAdmin's reply:\n"${args.reply}"\n\nOpen the request:\n${link}`,
    html: `<p>Hi ${exec.fullName ?? 'there'},</p><p>Admin replied to your help message on this request.</p><p><strong>Your question:</strong></p><blockquote>${escapeHtml(args.originalMessage)}</blockquote><p><strong>Admin's reply:</strong></p><blockquote>${escapeHtml(args.reply)}</blockquote><p><a href="${link}">Open the request</a></p>`,
    templateName: 'admin_help_replied',
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
