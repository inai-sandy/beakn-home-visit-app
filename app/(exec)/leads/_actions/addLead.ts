'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { db } from '@/db/client';
import { businessTypes, cities, leads, salesExecutives } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { leadSchema, type LeadInput } from '@/lib/validators/lead';

// =============================================================================
// HVA-73: addLeadAction — INSERT a captured lead
// =============================================================================
//
// Server Action. Validates via leadSchema, resolves FK existence (city,
// business_type), writes the row, revalidates the leads listing.
//
// Auth: any logged-in sales_executive or super_admin. captured_by_user_id
// is forced to session.user.id — the form can't claim a different owner.
// Phone is stored with the '+91' prefix on the wire (same convention as
// visit_requests.customer_phone) so cross-table joins on phone match.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const ALLOWED_ROLES = ['sales_executive', 'super_admin'] as const;

export async function addLeadAction(
  input: LeadInput,
): Promise<ActionResult<{ leadId: string }>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (!ALLOWED_ROLES.includes(actor.role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false, error: 'Forbidden' };
  }

  // Server-side re-validation. Client form uses the same schema via
  // react-hook-form's zodResolver, but a malicious client could bypass it.
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Some fields are invalid.', fieldErrors };
  }
  const data = parsed.data;

  // FK sanity — city exists.
  const [city] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.id, data.cityId))
    .limit(1);
  if (!city) {
    return { ok: false, error: 'Unknown city', fieldErrors: { cityId: 'Pick a valid city' } };
  }

  // FK sanity — business_type exists (only when Business lead).
  if (data.type === 'Business') {
    const [bt] = await db
      .select({ id: businessTypes.id })
      .from(businessTypes)
      .where(eq(businessTypes.id, data.businessTypeId))
      .limit(1);
    if (!bt) {
      return {
        ok: false,
        error: 'Unknown business type',
        fieldErrors: { businessTypeId: 'Pick a business type' },
      };
    }
  }

  // Persist. visit_requests stores phone as '+91XXXXXXXXXX'; mirror that
  // so a future "find lead → request by phone" query matches without a
  // normalisation step on both sides.
  const phoneWithPrefix = `+91${data.phone}`;

  const [inserted] = await db
    .insert(leads)
    .values({
      type: data.type,
      name: data.name,
      phone: phoneWithPrefix,
      email: data.email ?? null,
      cityId: data.cityId,
      interest: data.interest,
      notes: data.notes ?? null,
      bhk: data.type === 'Customer' ? (data.bhk ?? null) : null,
      firmName: data.type === 'Business' ? data.firmName : null,
      businessTypeId: data.type === 'Business' ? data.businessTypeId : null,
      capturedByUserId: actor.id,
    })
    .returning({ id: leads.id });

  revalidatePath('/', 'layout');
  return { ok: true, data: { leadId: inserted.id } };
}

// =============================================================================
// HVA-273: quickAddLeadAction — Quick Capture (name + phone only)
// =============================================================================
//
// Field-speed path: the exec types a name and a 10-digit number, we fill
// in everything else — type='Customer', interests empty, city = the
// exec's OWN city (sales_executives.city_id; locked decision D3).
//
// Duplicate phones (D4): phone is the project-wide dedup key. If the
// number already exists:
//   - captured by THIS exec → ok:false error='duplicate' with
//     fieldErrors.dupLeadId + fieldErrors.dupName so the sheet can offer
//     "Open contact". (fieldErrors doubles as the typed side-channel —
//     useServerMutation already forwards it.)
//   - captured by someone else → ok:false error='duplicate' WITHOUT the
//     id/name. Revealing another exec's contact would leak outside the
//     captured-by visibility rule.
// =============================================================================

const quickLeadSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/u, 'Enter a valid 10-digit mobile number'),
});

export type QuickLeadInput = z.infer<typeof quickLeadSchema>;

export async function quickAddLeadAction(
  input: QuickLeadInput,
): Promise<ActionResult<{ leadId: string; name: string }>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (!ALLOWED_ROLES.includes(actor.role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = quickLeadSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Some fields are invalid.', fieldErrors };
  }
  const data = parsed.data;

  // D3: city comes from the exec's own registration — no input needed.
  const [execRow] = await db
    .select({ cityId: salesExecutives.cityId })
    .from(salesExecutives)
    .where(eq(salesExecutives.userId, actor.id))
    .limit(1);
  if (!execRow?.cityId) {
    return {
      ok: false,
      error: 'Quick capture needs your city on file — use "Add full details" instead.',
    };
  }

  const phoneWithPrefix = `+91${data.phone}`;

  // D4: dedup by phone before inserting.
  const [existing] = await db
    .select({
      id: leads.id,
      name: leads.name,
      capturedByUserId: leads.capturedByUserId,
    })
    .from(leads)
    .where(eq(leads.phone, phoneWithPrefix))
    .limit(1);
  if (existing) {
    const visible = existing.capturedByUserId === actor.id;
    return {
      ok: false,
      error: 'duplicate',
      fieldErrors: visible
        ? { dupLeadId: existing.id, dupName: existing.name }
        : {},
    };
  }

  const [inserted] = await db
    .insert(leads)
    .values({
      type: 'Customer',
      name: data.name,
      phone: phoneWithPrefix,
      email: null,
      cityId: execRow.cityId,
      interest: [],
      notes: null,
      bhk: null,
      firmName: null,
      businessTypeId: null,
      capturedByUserId: actor.id,
    })
    .returning({ id: leads.id });

  revalidatePath('/', 'layout');
  return { ok: true, data: { leadId: inserted.id, name: data.name } };
}
