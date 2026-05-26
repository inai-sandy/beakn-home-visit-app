'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { cities, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES, isRole } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { canCaptainEditRequest } from '@/lib/captain/edit-auth';
import { canExecEditRequest } from '@/lib/exec/edit-auth';
import { toStorageFormat } from '@/lib/phone';

// =============================================================================
// HVA-159: editRequestAction — exec-side request edit
// =============================================================================
//
// Editable fields (D3 revised):
//   customerName, customerPhone, customerEmail, address, cityId, bhk,
//   customerState, visitScheduledAt.
//
// Auth (strict D2):
//   (assignedExecUserId = me) OR (a row in request_exec_assignments
//   with to_exec_user_id = me). No captor fallback (no captor field on
//   visit_requests; the original-assignee-reassigned-away gap is
//   accepted per Sandeep's explicit call).
//
// No phone-collision check on customer_phone — D3 says request phones
// are denormalized snapshots and allowed to drift from the linked
// contact. Editing here does NOT propagate to leads.phone (D5).
// =============================================================================

// HVA-163: captain joins the role gate. Role switch below routes to the
// right scope helper (canCaptainEditRequest / canExecEditRequest).
const ALLOWED_ROLES = ['sales_executive', 'captain', 'super_admin'] as const;
const ALLOWED_BHK = ['1BHK', '2BHK', '3BHK', '4BHK', 'Others'] as const;
type Bhk = (typeof ALLOWED_BHK)[number];

export interface EditRequestInput {
  requestId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  address: string;
  cityId: string;
  bhk: string;
  customerState: string | null;
  /** ISO timestamp (`YYYY-MM-DDTHH:mm[:ss[.SSS]]Z`) or null when not yet scheduled. */
  visitScheduledAt: string | null;
}

// 2026-05-26: narrowed to a discriminated union so useServerMutation's
// ActionResult constraint is satisfied. Callers already branch on
// `result.ok`, so this is a strict refinement, not a behavioural change.
export type EditRequestResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const EDITABLE_FIELDS = [
  'customerName',
  'customerPhone',
  'customerEmail',
  'address',
  'cityId',
  'bhk',
  'customerState',
  'visitScheduledAt',
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

function norm(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function isFieldChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  field: EditableField,
): boolean {
  return norm(before[field]) !== norm(after[field]);
}

export async function editRequestAction(
  input: EditRequestInput,
): Promise<EditRequestResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (!ALLOWED_ROLES.includes(actor.role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false, error: 'Forbidden' };
  }

  // HVA-163 role switch — super_admin always; exec via strict-D2; captain
  // via team-scoped helper (current assignee on team OR me as the
  // assigned captain).
  if (actor.role === USER_ROLES.SALES_EXECUTIVE) {
    const allowed = await canExecEditRequest(actor.id, input.requestId);
    if (!allowed) {
      return { ok: false, error: 'This request is not editable by you' };
    }
  } else if (actor.role === USER_ROLES.CAPTAIN) {
    const allowed = await canCaptainEditRequest(actor.id, input.requestId);
    if (!allowed) {
      return { ok: false, error: 'This request is not in your team' };
    }
  }

  // Field-level validation.
  const customerName = input.customerName.trim();
  if (customerName.length < 2 || customerName.length > 255) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { customerName: 'Name must be 2–255 characters' },
    };
  }
  const phoneStorage = toStorageFormat(input.customerPhone);
  if (!phoneStorage) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { customerPhone: 'Enter a valid 10-digit Indian mobile' },
    };
  }
  if (input.customerEmail && input.customerEmail.trim() !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail.trim())) {
      return {
        ok: false,
        error: 'Some fields are invalid.',
        fieldErrors: { customerEmail: 'Invalid email format' },
      };
    }
  }
  const address = input.address.trim();
  if (address.length < 10 || address.length > 2000) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { address: 'Address must be 10–2000 characters' },
    };
  }
  if (!ALLOWED_BHK.includes(input.bhk as Bhk)) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { bhk: 'Pick a valid BHK' },
    };
  }
  if (input.customerState && input.customerState.length > 100) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { customerState: 'State must be at most 100 characters' },
    };
  }

  // Parse visitScheduledAt — accept null, otherwise it must be a valid
  // ISO timestamp.
  let visitScheduledAtDate: Date | null = null;
  if (input.visitScheduledAt) {
    const parsed = new Date(input.visitScheduledAt);
    if (Number.isNaN(parsed.getTime())) {
      return {
        ok: false,
        error: 'Some fields are invalid.',
        fieldErrors: { visitScheduledAt: 'Invalid date/time' },
      };
    }
    visitScheduledAtDate = parsed;
  }

  // City FK sanity.
  const [city] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.id, input.cityId))
    .limit(1);
  if (!city) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { cityId: 'Pick a valid city' },
    };
  }

  const [existing] = await db
    .select()
    .from(visitRequests)
    .where(eq(visitRequests.id, input.requestId))
    .limit(1);
  if (!existing) return { ok: false, error: 'Request not found' };

  const next = {
    customerName,
    customerPhone: phoneStorage,
    customerEmail:
      input.customerEmail && input.customerEmail.trim() !== ''
        ? input.customerEmail.trim()
        : null,
    address,
    cityId: input.cityId,
    bhk: input.bhk as Bhk,
    customerState:
      input.customerState && input.customerState.trim() !== ''
        ? input.customerState.trim()
        : null,
    visitScheduledAt: visitScheduledAtDate,
  };

  const beforeState: Record<string, unknown> = {};
  const afterState: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (
      isFieldChanged(
        existing as unknown as Record<string, unknown>,
        next as unknown as Record<string, unknown>,
        field,
      )
    ) {
      beforeState[field] = norm(
        (existing as unknown as Record<string, unknown>)[field],
      );
      afterState[field] = norm(
        (next as unknown as Record<string, unknown>)[field],
      );
    }
  }

  if (Object.keys(afterState).length === 0) {
    return { ok: true, changed: false };
  }

  await db
    .update(visitRequests)
    .set(next)
    .where(eq(visitRequests.id, input.requestId));

  await logEvent({
    eventType: 'request_edited',
    actorUserId: actor.id,
    actorRole: isRole(actor.role) ? actor.role : null,
    targetEntityType: 'visit_request',
    targetEntityId: input.requestId,
    beforeState,
    afterState,
  });

  revalidatePath('/', 'layout');
  return { ok: true, changed: true };
}
