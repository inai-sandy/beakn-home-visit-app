'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { supportTicketCategories } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-256-FIX1: admin CRUD for support_ticket_categories
// =============================================================================
//
// super_admin can create new categories, rename existing ones, toggle
// active/inactive, and reorder via display_order. Code is editable only
// on create (immutable after). Code-based code-side branches (refund
// auto-close in payments/route.ts) keep working because admin can't
// rename the 'refund' code.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function requireSuperAdmin(): Promise<
  | { ok: true; userId: string; role: 'super_admin' }
  | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') return { ok: false, error: 'Forbidden' };
  return { ok: true, userId: user.id, role: 'super_admin' };
}

const codeRegex = /^[a-z][a-z0-9_]*$/;

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(codeRegex, 'Code must be lowercase letters, digits, underscores; start with a letter'),
  name: z.string().trim().min(1).max(100),
  displayOrder: z.number().int().min(0).max(9999),
});

export async function createTicketCategoryAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  try {
    const [row] = await db
      .insert(supportTicketCategories)
      .values({
        code: parsed.data.code,
        name: parsed.data.name,
        displayOrder: parsed.data.displayOrder,
      })
      .returning({ id: supportTicketCategories.id });

    await logEvent({
      eventType: 'support_ticket_category_created',
      actorUserId: auth.userId,
      actorRole: auth.role,
      targetEntityType: 'support_ticket_category',
      targetEntityId: row.id,
      afterState: {
        code: parsed.data.code,
        name: parsed.data.name,
        displayOrder: parsed.data.displayOrder,
        isActive: true,
      },
    });

    revalidatePath('/', 'layout');
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    if (err instanceof Error && err.message.toLowerCase().includes('unique')) {
      return { ok: false, error: 'A category with that code already exists' };
    }
    return { ok: false, error: 'Could not create category' };
  }
}

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  displayOrder: z.number().int().min(0).max(9999),
  isActive: z.boolean(),
});

export async function updateTicketCategoryAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const [before] = await db
    .select({
      id: supportTicketCategories.id,
      code: supportTicketCategories.code,
      name: supportTicketCategories.name,
      displayOrder: supportTicketCategories.displayOrder,
      isActive: supportTicketCategories.isActive,
    })
    .from(supportTicketCategories)
    .where(eq(supportTicketCategories.id, parsed.data.id))
    .limit(1);
  if (!before) return { ok: false, error: 'Category not found' };

  await db
    .update(supportTicketCategories)
    .set({
      name: parsed.data.name,
      displayOrder: parsed.data.displayOrder,
      isActive: parsed.data.isActive,
      updatedAt: new Date(),
    })
    .where(eq(supportTicketCategories.id, parsed.data.id));

  await logEvent({
    eventType: 'support_ticket_category_updated',
    actorUserId: auth.userId,
    actorRole: auth.role,
    targetEntityType: 'support_ticket_category',
    targetEntityId: parsed.data.id,
    beforeState: {
      name: before.name,
      displayOrder: before.displayOrder,
      isActive: before.isActive,
    },
    afterState: {
      name: parsed.data.name,
      displayOrder: parsed.data.displayOrder,
      isActive: parsed.data.isActive,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
