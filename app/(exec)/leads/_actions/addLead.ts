'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { businessTypes, cities, leads } from '@/db/schema';
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
