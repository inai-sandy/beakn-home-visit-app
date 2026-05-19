'use server';

import { and, eq, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { businessTypes, cities, leads, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES, isRole } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { canCaptainEditContact } from '@/lib/captain/edit-auth';
import { canExecEditContact } from '@/lib/exec/edit-auth';
import { toStorageFormat } from '@/lib/phone';

// =============================================================================
// HVA-159: editContactAction — exec-side contact edit
// =============================================================================
//
// Editable fields (D3 revised): name, firmName, phone, email, cityId,
// bhk, interest, businessTypeId, notes.
//
// Auth: canExecEditContact (delegates to PR 3 visibility set) — captor
// OR ever-assigned-to-a-request-linked-to-this-contact. super_admin is
// allowed an override.
//
// Phone collision (D2/D4): if phone changes, look up other leads with
// the same storage-form phone (+91-prefixed). On hit, refuse the save
// and surface the conflicting contact's name + total request count.
// Request phones (visit_requests.customer_phone) are denormalized
// snapshots and explicitly NOT checked.
//
// Audit: lib/audit.logEvent fires 'contact_edited' with sparse
// before/after JSONB carrying only the changed fields.
// =============================================================================

// HVA-163: captain joins the role gate. The actual scope check happens
// in the role switch below — captain goes through canCaptainEditContact
// (team-scoped), exec through canExecEditContact (visibility set),
// super_admin always allowed.
const ALLOWED_ROLES = ['sales_executive', 'captain', 'super_admin'] as const;

const ALLOWED_BHK = ['1BHK', '2BHK', '3BHK', '4BHK', 'Others'] as const;
type LeadBhk = (typeof ALLOWED_BHK)[number];

export interface EditContactInput {
  contactId: string;
  name: string;
  firmName: string | null;
  phone: string; // 10-digit; server prepends +91
  email: string | null;
  cityId: string;
  bhk: string | null; // enum value or null
  interest: string[];
  businessTypeId: string | null;
  notes: string | null;
}

export interface EditContactResult {
  ok: boolean;
  changed?: boolean;
  error?: string;
  collisionContactId?: string;
  fieldErrors?: Record<string, string>;
}

const EDITABLE_FIELDS = [
  'name',
  'firmName',
  'phone',
  'email',
  'cityId',
  'bhk',
  'interest',
  'businessTypeId',
  'notes',
] as const;

type EditableField = (typeof EDITABLE_FIELDS)[number];

function normaliseValue(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (Array.isArray(v)) return [...v].sort();
  return v;
}

function isFieldChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  field: EditableField,
): boolean {
  const b = normaliseValue(before[field]);
  const a = normaliseValue(after[field]);
  if (Array.isArray(b) && Array.isArray(a)) {
    if (b.length !== a.length) return true;
    for (let i = 0; i < b.length; i += 1) {
      if (b[i] !== a[i]) return true;
    }
    return false;
  }
  return b !== a;
}

export async function editContactAction(
  input: EditContactInput,
): Promise<EditContactResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (!ALLOWED_ROLES.includes(actor.role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false, error: 'Forbidden' };
  }

  // HVA-163 role switch:
  //   super_admin → always allowed (escape hatch).
  //   sales_executive → HVA-161 visibility set (captor OR ever-assigned).
  //   captain → team-scoped (captor sits on this captain's team).
  if (actor.role === USER_ROLES.SALES_EXECUTIVE) {
    const allowed = await canExecEditContact(actor.id, input.contactId);
    if (!allowed) {
      return { ok: false, error: 'This contact is not visible to you' };
    }
  } else if (actor.role === USER_ROLES.CAPTAIN) {
    const allowed = await canCaptainEditContact(actor.id, input.contactId);
    if (!allowed) {
      return { ok: false, error: 'This contact is not in your team' };
    }
  }

  // Field-level validation (basic — Zod-style guards live in
  // lib/validators/lead.ts for capture; we mirror the strict subset here
  // since edit operates on a single row).
  const name = input.name.trim();
  if (name.length < 2 || name.length > 100) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { name: 'Name must be 2–100 characters' },
    };
  }
  const phoneStorage = toStorageFormat(input.phone);
  if (!phoneStorage) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { phone: 'Enter a valid 10-digit Indian mobile' },
    };
  }
  if (input.email && input.email.trim() !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      return {
        ok: false,
        error: 'Some fields are invalid.',
        fieldErrors: { email: 'Invalid email format' },
      };
    }
  }
  if (input.notes && input.notes.length > 2000) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { notes: 'Notes must be at most 2000 characters' },
    };
  }
  if (input.firmName && input.firmName.length > 100) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { firmName: 'Firm name must be at most 100 characters' },
    };
  }
  if (
    input.bhk !== null &&
    !ALLOWED_BHK.includes(input.bhk as LeadBhk)
  ) {
    return {
      ok: false,
      error: 'Some fields are invalid.',
      fieldErrors: { bhk: 'Pick a valid BHK option' },
    };
  }

  // FK sanity: city + (optional) business type exist.
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

  if (input.businessTypeId) {
    const [bt] = await db
      .select({ id: businessTypes.id })
      .from(businessTypes)
      .where(eq(businessTypes.id, input.businessTypeId))
      .limit(1);
    if (!bt) {
      return {
        ok: false,
        error: 'Some fields are invalid.',
        fieldErrors: { businessTypeId: 'Pick a valid business type' },
      };
    }
  }

  // Load existing row.
  const [existing] = await db
    .select()
    .from(leads)
    .where(eq(leads.id, input.contactId))
    .limit(1);
  if (!existing) return { ok: false, error: 'Contact not found' };

  // Phone collision check — only fires when phone actually changes.
  if (existing.phone !== phoneStorage) {
    const [collision] = await db
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .where(and(eq(leads.phone, phoneStorage), ne(leads.id, input.contactId)))
      .limit(1);
    if (collision) {
      const [cnt] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(visitRequests)
        .where(eq(visitRequests.contactId, collision.id));
      const reqCount = cnt?.count ?? 0;
      return {
        ok: false,
        error: `This phone already belongs to contact ${collision.name} (${reqCount} request${reqCount === 1 ? '' : 's'}). Pick a different number, or use Merge (coming soon).`,
        collisionContactId: collision.id,
      };
    }
  }

  // Compose the post-edit shape. firmName / businessTypeId only meaningful
  // when type='Business'; bhk only meaningful when type='Customer'. We
  // accept whatever the form sent — type is immutable so this can't
  // cross-contaminate.
  const next = {
    name,
    firmName: existing.type === 'Business' ? input.firmName ?? null : null,
    phone: phoneStorage,
    email: input.email && input.email.trim() !== '' ? input.email.trim() : null,
    cityId: input.cityId,
    bhk: existing.type === 'Customer' ? (input.bhk as LeadBhk | null) : null,
    interest: input.interest,
    businessTypeId:
      existing.type === 'Business' ? input.businessTypeId ?? null : null,
    notes: input.notes && input.notes.trim() !== '' ? input.notes.trim() : null,
  };

  // Diff: capture only changed fields, sparse before/after.
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
      beforeState[field] = (existing as unknown as Record<string, unknown>)[field];
      afterState[field] = (next as unknown as Record<string, unknown>)[field];
    }
  }

  if (Object.keys(afterState).length === 0) {
    return { ok: true, changed: false };
  }

  await db
    .update(leads)
    .set(next)
    .where(eq(leads.id, input.contactId));

  await logEvent({
    eventType: 'contact_edited',
    actorUserId: actor.id,
    actorRole: isRole(actor.role) ? actor.role : null,
    targetEntityType: 'lead',
    targetEntityId: input.contactId,
    beforeState,
    afterState,
  });

  revalidatePath('/', 'layout');
  return { ok: true, changed: true };
}
