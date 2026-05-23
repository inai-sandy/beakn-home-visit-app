'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { announcementReads, announcements, resources } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-156: Resources + Announcements — server actions
// =============================================================================
//
// All write actions are super_admin only (D2). Resources are editable;
// announcements are append-only (D8) — there's no updateAnnouncement
// action by design.
//
// Mark-read writes for the viewing user (sales_executive | captain |
// super_admin). Idempotent via ON CONFLICT DO NOTHING on the composite PK.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

interface SuperAdminActor {
  id: string;
  role: 'super_admin';
}

async function authorizeSuperAdmin(): Promise<
  { ok: true; actor: SuperAdminActor } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const u = session.user as { id: string; role?: string };
  if (u.role !== USER_ROLES.SUPER_ADMIN) {
    return { ok: false, error: 'Forbidden' };
  }
  return { ok: true, actor: { id: u.id, role: 'super_admin' } };
}

async function authorizeAnyStaff(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const u = session.user as { id: string; role?: string };
  if (
    u.role !== USER_ROLES.SALES_EXECUTIVE &&
    u.role !== USER_ROLES.CAPTAIN &&
    u.role !== USER_ROLES.SUPER_ADMIN
  ) {
    return { ok: false, error: 'Forbidden' };
  }
  return { ok: true, userId: u.id };
}

// -----------------------------------------------------------------------------
// Resource actions
// -----------------------------------------------------------------------------

const resourceCategorySchema = z.enum([
  'sales_scripts',
  'pricing',
  'brand_assets',
  'training',
  'other',
]);

const createResourceSchema = z.object({
  category: resourceCategorySchema,
  title: z.string().trim().min(3, 'Title is too short').max(200, 'Title is too long'),
  body: z.string().trim().min(1, 'Body cannot be empty').max(20_000, 'Body is too long'),
});

export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export async function createResourceAction(
  input: CreateResourceInput,
): Promise<ActionResult<{ resourceId: string }>> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = createResourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  const [inserted] = await db
    .insert(resources)
    .values({
      category: data.category,
      title: data.title,
      body: data.body,
      createdByUserId: auth.actor.id,
    })
    .returning({ id: resources.id });

  await logEvent({
    eventType: 'resource_created',
    actorUserId: auth.actor.id,
    actorRole: 'super_admin',
    targetEntityType: 'resource',
    targetEntityId: inserted.id,
    afterState: {
      category: data.category,
      title: data.title,
      bodyLength: data.body.length,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { resourceId: inserted.id } };
}

const updateResourceSchema = z.object({
  id: z.string().uuid(),
  category: resourceCategorySchema,
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(20_000),
  isPublished: z.boolean(),
});

export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

export async function updateResourceAction(
  input: UpdateResourceInput,
): Promise<ActionResult> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = updateResourceSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  const [existing] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, data.id))
    .limit(1);
  if (!existing) return { ok: false, error: 'Resource not found' };

  const next = {
    category: data.category,
    title: data.title,
    body: data.body,
    isPublished: data.isPublished,
  };

  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const k of ['category', 'title', 'body', 'isPublished'] as const) {
    if ((existing as unknown as Record<string, unknown>)[k] !== next[k]) {
      beforeState[k] =
        k === 'body'
          ? `length=${String((existing as unknown as Record<string, string>)[k].length)}`
          : (existing as unknown as Record<string, unknown>)[k];
      afterState[k] = k === 'body' ? `length=${data.body.length}` : next[k];
    }
  }

  if (Object.keys(afterState).length === 0) {
    return { ok: true };
  }

  await db
    .update(resources)
    .set(next)
    .where(eq(resources.id, data.id));

  await logEvent({
    eventType: 'resource_updated',
    actorUserId: auth.actor.id,
    actorRole: 'super_admin',
    targetEntityType: 'resource',
    targetEntityId: data.id,
    beforeState,
    afterState,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Announcement actions
// -----------------------------------------------------------------------------

const createAnnouncementSchema = z.object({
  severity: z.enum(['info', 'important', 'urgent']),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(20_000),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export async function createAnnouncementAction(
  input: CreateAnnouncementInput,
): Promise<ActionResult<{ announcementId: string }>> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = createAnnouncementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const data = parsed.data;

  const [inserted] = await db
    .insert(announcements)
    .values({
      severity: data.severity,
      title: data.title,
      body: data.body,
      createdByUserId: auth.actor.id,
    })
    .returning({ id: announcements.id });

  await logEvent({
    eventType: 'announcement_created',
    actorUserId: auth.actor.id,
    actorRole: 'super_admin',
    targetEntityType: 'announcement',
    targetEntityId: inserted.id,
    afterState: {
      severity: data.severity,
      title: data.title,
      bodyLength: data.body.length,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { announcementId: inserted.id } };
}

const setAnnouncementPublishedSchema = z.object({
  id: z.string().uuid(),
  isPublished: z.boolean(),
});

export async function setAnnouncementPublishedAction(
  input: z.infer<typeof setAnnouncementPublishedSchema>,
): Promise<ActionResult> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = setAnnouncementPublishedSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input' };
  }

  await db
    .update(announcements)
    .set({ isPublished: parsed.data.isPublished })
    .where(eq(announcements.id, parsed.data.id));

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Mark-read (any authenticated staff)
// -----------------------------------------------------------------------------

/**
 * Idempotent bulk mark-read. Inserts an announcement_reads row for every
 * currently-published announcement the user hasn't already read. Composite
 * PK on (user_id, announcement_id) + ON CONFLICT DO NOTHING make repeat
 * calls a no-op.
 *
 * Called on /announcements page mount via a small client-side useEffect
 * that fires a server action; the page-data render itself doesn't need
 * the read state to flip until the next nav.
 */
export async function markAllAnnouncementsReadAction(): Promise<ActionResult> {
  const auth = await authorizeAnyStaff();
  if (!auth.ok) return auth;

  // Get every currently-published announcement id. Cheap — published set
  // is small (admin posts a few a week). Could be expressed as a single
  // INSERT ... SELECT subquery, but two queries are clearer + the JS
  // intermediate is tiny.
  const published = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(eq(announcements.isPublished, true));

  if (published.length === 0) {
    return { ok: true };
  }

  await db
    .insert(announcementReads)
    .values(
      published.map((p) => ({
        userId: auth.userId,
        announcementId: p.id,
      })),
    )
    .onConflictDoNothing();

  // No audit emission — mark-read is high-frequency routine activity, not
  // audit-worthy. (D-conf at recon: skip announcement_read event type.)

  revalidatePath('/', 'layout');
  return { ok: true };
}

// Silence unused-import warnings for symbols downstream tests may need.
void inArray;
void sql;
