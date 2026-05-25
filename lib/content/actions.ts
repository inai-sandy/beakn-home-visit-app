'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  announcementReads,
  announcements,
  resourceCategories,
  resources,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-156 + HVA-156-FIX1: Resources + Announcements — server actions
// =============================================================================
//
// All write actions are super_admin only. Resources are editable;
// announcements are append-only (D8 from HVA-156) — there's no
// updateAnnouncement action by design.
//
// FIX1 changes:
//   - Categories are now admin-managed; create / update / toggle-active
//     actions added
//   - createResource / updateResource take categoryId + url + description
//     (body field is gone)
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
// Slug helper — used when admin creates / renames a category
// -----------------------------------------------------------------------------
//
// Lowercases + collapses non-alphanumerics into single dashes + trims
// leading/trailing dashes. The DB uniqueness constraint on the slug
// catches collisions; the action surfaces a friendly error in that case.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

// -----------------------------------------------------------------------------
// Resource categories — admin CRUD
// -----------------------------------------------------------------------------

const createResourceCategorySchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80, 'Name is too long'),
  sortOrder: z.number().int().min(0).max(9999).default(100),
});

export type CreateResourceCategoryInput = z.infer<
  typeof createResourceCategorySchema
>;

export async function createResourceCategoryAction(
  input: CreateResourceCategoryInput,
): Promise<ActionResult<{ categoryId: string }>> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = createResourceCategorySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;
  const slug = slugify(data.name);
  if (slug.length === 0) {
    return { ok: false, error: 'Name must contain at least one letter' };
  }

  try {
    const [inserted] = await db
      .insert(resourceCategories)
      .values({
        name: data.name,
        slug,
        sortOrder: data.sortOrder,
      })
      .returning({ id: resourceCategories.id });

    await logEvent({
      eventType: 'resource_category_created',
      actorUserId: auth.actor.id,
      actorRole: 'super_admin',
      targetEntityType: 'resource_category',
      targetEntityId: inserted.id,
      afterState: { name: data.name, slug, sortOrder: data.sortOrder },
    });

    revalidatePath('/', 'layout');
    return { ok: true, data: { categoryId: inserted.id } };
  } catch (err) {
    // postgres-js + Drizzle: the constraint name lives on the inner
    // PostgresError. Walk the cause chain looking for `constraint_name`.
    const constraint = findConstraintName(err);
    if (constraint === 'resource_categories_name_unique') {
      return { ok: false, error: 'A category with this name already exists' };
    }
    if (constraint === 'resource_categories_slug_unique') {
      return { ok: false, error: 'A category with a similar name already exists' };
    }
    throw err;
  }
}

/** Walk a thrown error + its cause chain looking for the `constraint_name`
 *  field that postgres-js attaches to unique-violation errors. */
function findConstraintName(err: unknown): string {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i += 1) {
    const candidate = current as { constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.constraint_name === 'string') {
      return candidate.constraint_name;
    }
    current = candidate.cause;
  }
  return '';
}

const updateResourceCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  sortOrder: z.number().int().min(0).max(9999),
  isActive: z.boolean(),
});

export type UpdateResourceCategoryInput = z.infer<
  typeof updateResourceCategorySchema
>;

export async function updateResourceCategoryAction(
  input: UpdateResourceCategoryInput,
): Promise<ActionResult> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = updateResourceCategorySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  const [existing] = await db
    .select()
    .from(resourceCategories)
    .where(eq(resourceCategories.id, data.id))
    .limit(1);
  if (!existing) return { ok: false, error: 'Category not found' };

  // Recompute slug only when the name changed.
  const nextSlug =
    existing.name === data.name ? existing.slug : slugify(data.name);
  if (nextSlug.length === 0) {
    return { ok: false, error: 'Name must contain at least one letter' };
  }

  const next = {
    name: data.name,
    slug: nextSlug,
    sortOrder: data.sortOrder,
    isActive: data.isActive,
  };

  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const k of ['name', 'slug', 'sortOrder', 'isActive'] as const) {
    if (
      (existing as unknown as Record<string, unknown>)[k] !==
      (next as Record<string, unknown>)[k]
    ) {
      beforeState[k] = (existing as unknown as Record<string, unknown>)[k];
      afterState[k] = (next as Record<string, unknown>)[k];
    }
  }

  if (Object.keys(afterState).length === 0) {
    return { ok: true };
  }

  try {
    await db
      .update(resourceCategories)
      .set(next)
      .where(eq(resourceCategories.id, data.id));

    await logEvent({
      eventType: 'resource_category_updated',
      actorUserId: auth.actor.id,
      actorRole: 'super_admin',
      targetEntityType: 'resource_category',
      targetEntityId: data.id,
      beforeState,
      afterState,
    });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    const constraint = findConstraintName(err);
    if (constraint === 'resource_categories_name_unique') {
      return { ok: false, error: 'Another category already has this name' };
    }
    if (constraint === 'resource_categories_slug_unique') {
      return { ok: false, error: 'Another category has a similar name' };
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Resource actions
// -----------------------------------------------------------------------------

// http(s)://… — anything else is rejected. Keeps malformed bookmarks out of
// the read surface where the Share button would fail silently.
const urlSchema = z
  .string()
  .trim()
  .url('Enter a valid URL (https://…)')
  .max(2000, 'URL is too long');

const createResourceSchema = z.object({
  categoryId: z.string().uuid('Pick a category'),
  title: z.string().trim().min(3, 'Title is too short').max(200, 'Title is too long'),
  url: urlSchema,
  description: z
    .string()
    .trim()
    .max(500, 'Description is too long')
    .optional()
    .or(z.literal('')),
});

export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export async function createResourceAction(
  input: CreateResourceInput,
): Promise<ActionResult<{ resourceId: string }>> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = createResourceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  // Defensive: confirm the category exists and is active. The dropdown
  // only lists active categories, but a stale client tab could submit
  // a deactivated id; reject so we don't publish under a hidden category.
  const [cat] = await db
    .select({ isActive: resourceCategories.isActive })
    .from(resourceCategories)
    .where(eq(resourceCategories.id, data.categoryId))
    .limit(1);
  if (!cat) return { ok: false, error: 'Category not found' };
  if (!cat.isActive) {
    return { ok: false, error: 'Category is inactive — pick another' };
  }

  const description =
    data.description && data.description.length > 0 ? data.description : null;

  const [inserted] = await db
    .insert(resources)
    .values({
      categoryId: data.categoryId,
      title: data.title,
      url: data.url,
      description,
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
      categoryId: data.categoryId,
      title: data.title,
      url: data.url,
      hasDescription: description !== null,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { resourceId: inserted.id } };
}

const updateResourceSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  url: urlSchema,
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal('')),
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
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  const [existing] = await db
    .select()
    .from(resources)
    .where(eq(resources.id, data.id))
    .limit(1);
  if (!existing) return { ok: false, error: 'Resource not found' };

  // Validate the category exists (it may be deactivated — admin edit
  // is allowed against an inactive category since the row has historical
  // value).
  const [cat] = await db
    .select({ id: resourceCategories.id })
    .from(resourceCategories)
    .where(eq(resourceCategories.id, data.categoryId))
    .limit(1);
  if (!cat) return { ok: false, error: 'Category not found' };

  const description =
    data.description && data.description.length > 0 ? data.description : null;

  const next = {
    categoryId: data.categoryId,
    title: data.title,
    url: data.url,
    description,
    isPublished: data.isPublished,
  };

  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const k of [
    'categoryId',
    'title',
    'url',
    'description',
    'isPublished',
  ] as const) {
    if (
      (existing as unknown as Record<string, unknown>)[k] !==
      (next as Record<string, unknown>)[k]
    ) {
      beforeState[k] = (existing as unknown as Record<string, unknown>)[k];
      afterState[k] = (next as Record<string, unknown>)[k];
    }
  }

  if (Object.keys(afterState).length === 0) {
    return { ok: true };
  }

  await db.update(resources).set(next).where(eq(resources.id, data.id));

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
// Announcement actions (unchanged from HVA-156)
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
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
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

export async function markAllAnnouncementsReadAction(): Promise<ActionResult> {
  const auth = await authorizeAnyStaff();
  if (!auth.ok) return auth;

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

  revalidatePath('/', 'layout');
  return { ok: true };
}
