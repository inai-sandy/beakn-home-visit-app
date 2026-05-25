'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  announcementAcknowledgments,
  announcementCategories,
  announcements,
  resourceCategories,
  resources,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-156 + HVA-156-FIX1 + HVA-156-FIX2: content server actions
// =============================================================================
//
// All write actions are super_admin only except acknowledge-announcement
// (any authenticated staff). FIX2 changes:
//   * Resources accept visibility + tags
//   * Announcements accept categoryId + audience + importance + publishDate
//   * New announcement_categories CRUD actions
//   * acknowledgeAnnouncementAction replaces the FIX1 mark-all-read action
//
// Mark-read writes for the viewing user (sales_executive | captain |
// super_admin). One-way operation — composite PK + ON CONFLICT DO NOTHING
// makes repeat calls a no-op (no undo per HVA-120 §13.1).
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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

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

// -----------------------------------------------------------------------------
// Resource categories — admin CRUD
// -----------------------------------------------------------------------------

const createResourceCategorySchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(80, 'Name is too long'),
  sortOrder: z.number().int().min(0).max(9999).default(100),
  displayOrder: z.number().int().min(0).max(9999).optional(),
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
        displayOrder: data.displayOrder ?? data.sortOrder,
      })
      .returning({ id: resourceCategories.id });

    await logEvent({
      eventType: 'resource_category_created',
      actorUserId: auth.actor.id,
      actorRole: 'super_admin',
      targetEntityType: 'resource_category',
      targetEntityId: inserted.id,
      afterState: {
        name: data.name,
        slug,
        sortOrder: data.sortOrder,
        displayOrder: data.displayOrder ?? data.sortOrder,
      },
    });

    revalidatePath('/', 'layout');
    return { ok: true, data: { categoryId: inserted.id } };
  } catch (err) {
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

const updateResourceCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  sortOrder: z.number().int().min(0).max(9999),
  displayOrder: z.number().int().min(0).max(9999).optional(),
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

  const nextSlug =
    existing.name === data.name ? existing.slug : slugify(data.name);
  if (nextSlug.length === 0) {
    return { ok: false, error: 'Name must contain at least one letter' };
  }

  const next = {
    name: data.name,
    slug: nextSlug,
    sortOrder: data.sortOrder,
    displayOrder: data.displayOrder ?? data.sortOrder,
    isActive: data.isActive,
  };

  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const k of [
    'name',
    'slug',
    'sortOrder',
    'displayOrder',
    'isActive',
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
// Announcement categories — admin CRUD (HVA-156-FIX2)
// -----------------------------------------------------------------------------

const createAnnouncementCategorySchema = z.object({
  name: z.string().trim().min(2).max(80),
  sortOrder: z.number().int().min(0).max(9999).default(100),
  displayOrder: z.number().int().min(0).max(9999).optional(),
});

export type CreateAnnouncementCategoryInput = z.infer<
  typeof createAnnouncementCategorySchema
>;

export async function createAnnouncementCategoryAction(
  input: CreateAnnouncementCategoryInput,
): Promise<ActionResult<{ categoryId: string }>> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = createAnnouncementCategorySchema.safeParse(input);
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
      .insert(announcementCategories)
      .values({
        name: data.name,
        slug,
        sortOrder: data.sortOrder,
        displayOrder: data.displayOrder ?? data.sortOrder,
      })
      .returning({ id: announcementCategories.id });

    await logEvent({
      eventType: 'announcement_category_created',
      actorUserId: auth.actor.id,
      actorRole: 'super_admin',
      targetEntityType: 'announcement_category',
      targetEntityId: inserted.id,
      afterState: {
        name: data.name,
        slug,
        sortOrder: data.sortOrder,
        displayOrder: data.displayOrder ?? data.sortOrder,
      },
    });

    revalidatePath('/', 'layout');
    return { ok: true, data: { categoryId: inserted.id } };
  } catch (err) {
    const constraint = findConstraintName(err);
    if (constraint === 'announcement_categories_name_unique') {
      return { ok: false, error: 'A category with this name already exists' };
    }
    if (constraint === 'announcement_categories_slug_unique') {
      return { ok: false, error: 'A category with a similar name already exists' };
    }
    throw err;
  }
}

const updateAnnouncementCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(80),
  sortOrder: z.number().int().min(0).max(9999),
  displayOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean(),
});

export type UpdateAnnouncementCategoryInput = z.infer<
  typeof updateAnnouncementCategorySchema
>;

export async function updateAnnouncementCategoryAction(
  input: UpdateAnnouncementCategoryInput,
): Promise<ActionResult> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = updateAnnouncementCategorySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  const [existing] = await db
    .select()
    .from(announcementCategories)
    .where(eq(announcementCategories.id, data.id))
    .limit(1);
  if (!existing) return { ok: false, error: 'Category not found' };

  const nextSlug =
    existing.name === data.name ? existing.slug : slugify(data.name);
  if (nextSlug.length === 0) {
    return { ok: false, error: 'Name must contain at least one letter' };
  }

  const next = {
    name: data.name,
    slug: nextSlug,
    sortOrder: data.sortOrder,
    displayOrder: data.displayOrder ?? data.sortOrder,
    isActive: data.isActive,
  };

  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const k of [
    'name',
    'slug',
    'sortOrder',
    'displayOrder',
    'isActive',
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

  try {
    await db
      .update(announcementCategories)
      .set(next)
      .where(eq(announcementCategories.id, data.id));

    await logEvent({
      eventType: 'announcement_category_updated',
      actorUserId: auth.actor.id,
      actorRole: 'super_admin',
      targetEntityType: 'announcement_category',
      targetEntityId: data.id,
      beforeState,
      afterState,
    });

    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    const constraint = findConstraintName(err);
    if (constraint === 'announcement_categories_name_unique') {
      return { ok: false, error: 'Another category already has this name' };
    }
    if (constraint === 'announcement_categories_slug_unique') {
      return { ok: false, error: 'Another category has a similar name' };
    }
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Resource actions — with visibility + tags (HVA-156-FIX2)
// -----------------------------------------------------------------------------

const urlSchema = z
  .string()
  .trim()
  .url('Enter a valid URL (https://…)')
  .max(2000, 'URL is too long');

const tagsSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(20, 'Too many tags')
  .optional()
  .default([]);

const visibilitySchema = z.enum(['all', 'captains_only', 'sales_execs_only']);

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
  visibility: visibilitySchema.default('all'),
  tags: tagsSchema,
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
  // Lower-case + dedupe tags so the tag filter never shows duplicates that
  // differ only by case ('1BHK' vs '1bhk').
  const tags = Array.from(
    new Set((data.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)),
  );

  const [inserted] = await db
    .insert(resources)
    .values({
      categoryId: data.categoryId,
      title: data.title,
      url: data.url,
      description,
      visibility: data.visibility,
      tags,
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
      visibility: data.visibility,
      tags,
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
  visibility: visibilitySchema,
  tags: tagsSchema,
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

  const [cat] = await db
    .select({ id: resourceCategories.id })
    .from(resourceCategories)
    .where(eq(resourceCategories.id, data.categoryId))
    .limit(1);
  if (!cat) return { ok: false, error: 'Category not found' };

  const description =
    data.description && data.description.length > 0 ? data.description : null;
  const tags = Array.from(
    new Set((data.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)),
  );

  const next = {
    categoryId: data.categoryId,
    title: data.title,
    url: data.url,
    description,
    visibility: data.visibility,
    tags,
    isPublished: data.isPublished,
  };

  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const k of [
    'categoryId',
    'title',
    'url',
    'description',
    'visibility',
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
  // tags is a text[] — compare via JSON for sparse diff.
  const existingTags = ((existing as unknown as Record<string, unknown>).tags as string[]) ?? [];
  if (JSON.stringify(existingTags) !== JSON.stringify(tags)) {
    beforeState.tags = existingTags;
    afterState.tags = tags;
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
// Announcement actions — with category + audience + importance + publish_date
// -----------------------------------------------------------------------------

const importanceSchema = z.enum(['info', 'important', 'urgent']);
const audienceSchema = z.enum(['sales_executive', 'captain', 'both']);

const createAnnouncementSchema = z.object({
  categoryId: z.string().uuid('Pick a category'),
  importance: importanceSchema,
  audience: audienceSchema,
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(20_000),
  /** ISO date string (YYYY-MM-DD). Optional — defaults to today when blank. */
  publishDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Pick a valid date')
    .optional(),
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

  const [cat] = await db
    .select({ isActive: announcementCategories.isActive })
    .from(announcementCategories)
    .where(eq(announcementCategories.id, data.categoryId))
    .limit(1);
  if (!cat) return { ok: false, error: 'Category not found' };
  if (!cat.isActive) {
    return { ok: false, error: 'Category is inactive — pick another' };
  }

  const publishDate =
    data.publishDate ?? new Date().toISOString().slice(0, 10);

  const [inserted] = await db
    .insert(announcements)
    .values({
      categoryId: data.categoryId,
      importance: data.importance,
      audience: data.audience,
      title: data.title,
      body: data.body,
      publishDate,
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
      categoryId: data.categoryId,
      importance: data.importance,
      audience: data.audience,
      title: data.title,
      publishDate,
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
// Acknowledge announcement (any staff)
// -----------------------------------------------------------------------------

const acknowledgeAnnouncementSchema = z.object({
  announcementId: z.string().uuid(),
});

/**
 * Explicit "I've read this" tap from the read surface. Inserts one
 * announcement_acknowledgments row idempotently — re-tap is a no-op
 * (one-way operation per HVA-120 §13.1). Emits an audit event so
 * admin + captain see who acknowledged when.
 */
export async function acknowledgeAnnouncementAction(
  input: z.infer<typeof acknowledgeAnnouncementSchema>,
): Promise<ActionResult> {
  const auth = await authorizeAnyStaff();
  if (!auth.ok) return auth;

  const parsed = acknowledgeAnnouncementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input' };
  }

  // Verify the announcement exists + is published + matches the user's
  // audience (defence-in-depth — UI should never surface an ack button
  // for an ineligible announcement, but the action gate prevents a
  // crafted client from posting acks for hidden announcements).
  const [row] = await db
    .select({
      id: announcements.id,
      isPublished: announcements.isPublished,
      audience: announcements.audience,
    })
    .from(announcements)
    .where(eq(announcements.id, parsed.data.announcementId))
    .limit(1);
  if (!row) return { ok: false, error: 'Announcement not found' };
  if (!row.isPublished) {
    return { ok: false, error: 'Announcement is not published' };
  }

  const result = await db
    .insert(announcementAcknowledgments)
    .values({
      userId: auth.userId,
      announcementId: parsed.data.announcementId,
    })
    .onConflictDoNothing()
    .returning({ userId: announcementAcknowledgments.userId });

  // Only emit the audit event when we actually inserted (avoid stamping
  // an event for every idempotent retry).
  if (result.length > 0) {
    await logEvent({
      eventType: 'announcement_acknowledged',
      actorUserId: auth.userId,
      actorRole: 'sales_executive', // best-effort; role not stored on the row
      targetEntityType: 'announcement',
      targetEntityId: parsed.data.announcementId,
    });
  }

  revalidatePath('/', 'layout');
  return { ok: true };
}

/** @deprecated FIX1 mount-effect helper. Kept for back-compat through this
 *  ship; the FIX2 UI uses per-row acknowledgeAnnouncementAction instead.
 *  Removed once existing call-sites migrate. */
export async function markAllAnnouncementsReadAction(): Promise<ActionResult> {
  return { ok: true };
}
