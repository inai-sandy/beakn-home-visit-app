'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { holidays } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-93: Holidays config — admin CRUD
// =============================================================================
//
// Single-date holidays applies-to-all-cities per option 7A. Schema has
// startDate + endDate (range support) but the form sets them equal for
// the single-date case. Multi-day ranges + per-city scoping are deferred.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function authorizeSuperAdmin(): Promise<
  { ok: true; actorId: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const u = session.user as { id: string; role?: string };
  if (u.role !== USER_ROLES.SUPER_ADMIN) {
    return { ok: false, error: 'Forbidden' };
  }
  return { ok: true, actorId: u.id };
}

const createHolidaySchema = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(255, 'Name is too long'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Pick a valid date (YYYY-MM-DD)'),
});

export type CreateHolidayInput = z.infer<typeof createHolidaySchema>;

export async function createHolidayAction(
  input: CreateHolidayInput,
): Promise<ActionResult<{ holidayId: string }>> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = createHolidaySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  const [inserted] = await db
    .insert(holidays)
    .values({
      name: data.name,
      startDate: data.date,
      endDate: data.date,
      appliesToCityIds: null, // all cities
    })
    .returning({ id: holidays.id });

  await logEvent({
    eventType: 'holiday_created',
    actorUserId: auth.actorId,
    actorRole: 'super_admin',
    targetEntityType: 'holiday',
    targetEntityId: inserted.id,
    afterState: { name: data.name, date: data.date, scope: 'all_cities' },
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { holidayId: inserted.id } };
}

const updateHolidaySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(255),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  isActive: z.boolean(),
});

export type UpdateHolidayInput = z.infer<typeof updateHolidaySchema>;

export async function updateHolidayAction(
  input: UpdateHolidayInput,
): Promise<ActionResult> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = updateHolidaySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  const [existing] = await db
    .select()
    .from(holidays)
    .where(eq(holidays.id, data.id))
    .limit(1);
  if (!existing) return { ok: false, error: 'Holiday not found' };

  const next = {
    name: data.name,
    startDate: data.date,
    endDate: data.date,
    isActive: data.isActive,
  };
  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const k of ['name', 'startDate', 'endDate', 'isActive'] as const) {
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

  await db.update(holidays).set(next).where(eq(holidays.id, data.id));

  await logEvent({
    eventType: 'holiday_updated',
    actorUserId: auth.actorId,
    actorRole: 'super_admin',
    targetEntityType: 'holiday',
    targetEntityId: data.id,
    beforeState,
    afterState,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function loadAllHolidaysForAdmin() {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) throw new Error(auth.error);

  return db
    .select({
      id: holidays.id,
      name: holidays.name,
      startDate: holidays.startDate,
      endDate: holidays.endDate,
      isActive: holidays.isActive,
      createdAt: holidays.createdAt,
      updatedAt: holidays.updatedAt,
    })
    .from(holidays)
    .orderBy(holidays.startDate);
}

// Silence unused import
void and;
