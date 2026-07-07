import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { leads, salesExecutives, users, visitRequests } from '@/db/schema';
import { log } from '@/lib/logger';
import { normalizeIndianPhone, toStorageFormat } from '@/lib/phone';

// =============================================================================
// HVA-73 PR 2: find-or-create-contact helper
// =============================================================================
//
// Called from the captain assignment route after the request has been
// flipped to ASSIGNED. Behaviour:
//
//   1. If the request already has contact_id set (e.g. lead-conversion
//      flow from HVA-74), no-op. The lead-conversion already owns the link.
//   2. Normalise the customer's phone. If it's not a recognisable Indian
//      mobile, log a warning and no-op — the assignment itself succeeds.
//   3. Look up a lead by phone (storage form: '+91' + 10 digits).
//   4. Not found → INSERT a new lead with type='Customer', captured_by
//      set to the freshly-assigned exec.
//   5. Return { contactId, created } so the caller can:
//       - patch `visit_requests.contact_id`
//       - decide whether to audit-log 'created' vs 'linked'
//
// We DO NOT take a tx parameter here. The find-or-create runs as its
// own pair of queries; the caller stitches the contact_id back to the
// visit_request *after* the transition tx commits. Rationale: the
// transition tx already commits with assigned_exec_user_id set — if the
// follow-up contact-linker call fails for any reason, the assignment
// itself stays correct and a subsequent walk can retry without
// re-running a status transition. This matches the spirit of the
// existing "fire-and-forget audit after transition" pattern in the
// assignment route.
// =============================================================================

export interface FindOrCreateContactInput {
  requestId: string;
  /** Stored form: '+91' + 10 digits (the value already on the visit_requests row). */
  customerPhone: string;
  customerName: string;
  customerEmail: string | null;
  cityId: string;
  bhk: string;
  /**
   * The exec the request was just assigned to. They become the captor
   * of the newly-created contact (D2).
   */
  assignedExecUserId: string;
}

export interface FindOrCreateContactResult {
  /** null when phone normalisation failed — caller should skip patching. */
  contactId: string | null;
  /** True when this call inserted a new leads row; false when an existing lead matched. */
  created: boolean;
  /** Set when contactId is null so the caller can log/skip. */
  skipReason?: 'invalid_phone' | 'no_phone';
}

export interface OwningExec {
  execUserId: string;
  /** The owning exec's display name — populates request.assigned notifications. */
  execName: string;
  /**
   * The owning exec's OWN captain (sales_executives.captain_user_id) —
   * used for assigned_captain_user_id. "Follow the exec" across cities:
   * we route to the exec regardless of the new request's city, and keep
   * team scoping consistent with the exec's captain.
   */
  captainUserId: string;
}

// =============================================================================
// HVA-256: "sticky" account ownership — auto-route returning contacts
// =============================================================================
//
// When a customer who has been worked before (matched by phone) raises a
// NEW web request, route it straight to the exec who most recently owned
// a request for that phone, instead of dropping it into the captain's
// unassigned queue.
//
// Owner = the exec on the contact's MOST-RECENT request that carries an
// exec (ordered by assigned_at desc). This follows reassignments: if the
// account moved A→B, B is returned (the live owner), not the original
// captor. We deliberately don't read leads.captured_by_user_id (that's
// the FIRST captor and can be stale after a reassign).
//
// Returns null — caller falls back to the normal unassigned SUBMITTED
// flow — when:
//   * phone is unparseable,
//   * no prior request for this phone was ever assigned to an exec,
//   * the owning exec is inactive (users.is_active = false) or is no
//     longer a sales_executive (no row). We don't route into a dead
//     account; a captain assigns it manually as before.
//
// Unlike is_unavailable (a soft "out today" flag that does NOT block —
// matching the manual assign route's HVA-81 behaviour), an INACTIVE user
// is a hard skip.
// =============================================================================

export async function resolveOwningExecForPhone(
  customerPhone: string,
): Promise<OwningExec | null> {
  const normalised = normalizeIndianPhone(customerPhone);
  if (!normalised) return null;
  const storage = toStorageFormat(normalised);
  if (!storage) return null;

  // Most-recent prior request for this phone that carries an exec.
  // NULLS LAST guards the (defensive) case of an assigned row with a null
  // assigned_at — Postgres orders NULLs first under plain DESC, which would
  // otherwise let a legacy null-timestamp row shadow a genuinely newer one.
  const [prior] = await db
    .select({ execUserId: visitRequests.assignedExecUserId })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.customerPhone, storage),
        isNotNull(visitRequests.assignedExecUserId),
      ),
    )
    .orderBy(sql`${visitRequests.assignedAt} DESC NULLS LAST`)
    .limit(1);
  if (!prior?.execUserId) return null;

  // The candidate must still be an active sales executive. Their own
  // captain becomes assigned_captain_user_id (follow-the-exec).
  const [exec] = await db
    .select({
      userId: salesExecutives.userId,
      captainUserId: salesExecutives.captainUserId,
      fullName: users.fullName,
      isActive: users.isActive,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(eq(salesExecutives.userId, prior.execUserId))
    .limit(1);
  if (!exec || !exec.isActive) return null;

  return {
    execUserId: exec.userId,
    execName: exec.fullName,
    captainUserId: exec.captainUserId,
  };
}

export async function findOrCreateContactForAssignment(
  input: FindOrCreateContactInput,
): Promise<FindOrCreateContactResult> {
  const normalised = normalizeIndianPhone(input.customerPhone);
  if (!normalised) {
    log.warn(
      {
        component: 'captain.assignment.contact-linker',
        requestId: input.requestId,
        phone_present: Boolean(input.customerPhone),
        msg: 'phone_unparseable_skipping_contact_link',
      },
      'contact_linker_skip',
    );
    return {
      contactId: null,
      created: false,
      skipReason: input.customerPhone ? 'invalid_phone' : 'no_phone',
    };
  }

  const storage = toStorageFormat(normalised);
  if (!storage) {
    // toStorageFormat returns null only when normalizeIndianPhone returns
    // null; guarded above. Defensive.
    return { contactId: null, created: false, skipReason: 'invalid_phone' };
  }

  // 1. Try existing lead by phone.
  const existing = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.phone, storage))
    .limit(1);
  if (existing[0]) {
    return { contactId: existing[0].id, created: false };
  }

  // 2. Insert new lead. type='Customer', interests=[], BHK from request.
  const allowedBhk = ['1BHK', '2BHK', '3BHK', '4BHK', 'Others'] as const;
  type LeadBhk = (typeof allowedBhk)[number];
  const bhkForLead: LeadBhk | null = (allowedBhk as readonly string[]).includes(input.bhk)
    ? (input.bhk as LeadBhk)
    : null;

  const [inserted] = await db
    .insert(leads)
    .values({
      type: 'Customer',
      name: input.customerName,
      phone: storage,
      email: input.customerEmail,
      cityId: input.cityId,
      bhk: bhkForLead,
      interest: [],
      capturedByUserId: input.assignedExecUserId,
    })
    .returning({ id: leads.id });

  return { contactId: inserted.id, created: true };
}
