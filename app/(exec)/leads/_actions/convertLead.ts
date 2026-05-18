'use server';

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import {
  cities,
  leads,
  requestStatusHistory,
  statusStages,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES, isRole } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { log } from '@/lib/logger';
import {
  convertLeadExtraFieldsSchema,
  type ConvertLeadExtraFieldsInput,
} from '@/lib/validators/lead';

// =============================================================================
// HVA-74: convertLeadToRequestAction — Lead → visit_request
// =============================================================================
//
// Flow (single transaction):
//   1. Auth + ownership: lead.captured_by_user_id must equal the actor
//      (or actor is super_admin). Skipping this would let a different
//      exec convert someone else's lead.
//   2. Validate extra fields (address, bhk, optional state).
//   3. Refuse if lead.converted_to_request_id is already set.
//   4. Resolve the ASSIGNED status_stage id once.
//   5. INSERT visit_requests with assigned_exec_user_id = actor,
//      assigned_captain_user_id = city.captain_user_id, statusStageId =
//      ASSIGNED, source = 'lead_conversion', tracking_token via nanoid.
//   6. INSERT request_status_history initial row (from=NULL,
//      to=ASSIGNED, transition_order=1, sequence_number=2). Keeps the
//      audit trail intact even though we skipped SUBMITTED.
//   7. UPDATE leads SET converted_to_request_id, converted_at.
//   8. Audit log entry ('lead_converted_to_request').
//   9. Stub the captain notification (console.log + TODO HVA-79); the
//      action does NOT block on notification readiness.
//
// `request_status_history.sequence_number = 2` matches the canonical
// ASSIGNED stage's seq number in the seeded status_stages table
// (migration 0005). Hardcoded here because we already resolved the
// stage row.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

const ALLOWED_ROLES = ['sales_executive', 'super_admin'] as const;

export interface ConvertLeadInput {
  leadId: string;
  extra: ConvertLeadExtraFieldsInput;
}

export async function convertLeadToRequestAction(
  input: ConvertLeadInput,
): Promise<ActionResult<{ requestId: string }>> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string; fullName?: string };
  if (!ALLOWED_ROLES.includes(actor.role as (typeof ALLOWED_ROLES)[number])) {
    return { ok: false, error: 'Forbidden' };
  }

  const parsedExtra = convertLeadExtraFieldsSchema.safeParse(input.extra);
  if (!parsedExtra.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsedExtra.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Some fields are invalid.', fieldErrors };
  }
  const extra = parsedExtra.data;

  const [lead] = await db
    .select({
      id: leads.id,
      type: leads.type,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      cityId: leads.cityId,
      cityName: cities.name,
      cityState: cities.state,
      bhk: leads.bhk,
      interest: leads.interest,
      capturedByUserId: leads.capturedByUserId,
      convertedToRequestId: leads.convertedToRequestId,
    })
    .from(leads)
    .innerJoin(cities, eq(cities.id, leads.cityId))
    .where(eq(leads.id, input.leadId))
    .limit(1);

  if (!lead) return { ok: false, error: 'Lead not found' };

  // Ownership: only the exec who captured it (or admin) can convert it.
  if (
    actor.role !== USER_ROLES.SUPER_ADMIN &&
    lead.capturedByUserId !== actor.id
  ) {
    return { ok: false, error: 'You can only convert your own leads' };
  }

  // Idempotency: once converted, refuse to convert again. The UI hides
  // the action but a stale tab could still try.
  if (lead.convertedToRequestId !== null) {
    return { ok: false, error: 'Lead is already converted' };
  }

  // Resolve the ASSIGNED stage id + the city's captain (for
  // assigned_captain_user_id mirroring visit_requests semantics).
  const [assignedStage] = await db
    .select({ id: statusStages.id, sequenceNumber: statusStages.sequenceNumber })
    .from(statusStages)
    .where(eq(statusStages.code, 'ASSIGNED'))
    .limit(1);
  if (!assignedStage) {
    return { ok: false, error: 'ASSIGNED stage missing — contact admin' };
  }

  const [cityRow] = await db
    .select({ captainUserId: cities.captainUserId })
    .from(cities)
    .where(eq(cities.id, lead.cityId))
    .limit(1);

  // Lead's bhk may be null (Business leads); the form makes the exec
  // pick one in the conversion sheet. extra.bhk is required.
  const now = new Date();

  // Generate a unique tracking_token (collision loop matches the public
  // /api/customer-request route).
  let trackingToken = nanoid(21);
  for (let i = 0; i < 5; i += 1) {
    const [existing] = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(eq(visitRequests.trackingToken, trackingToken))
      .limit(1);
    if (!existing) break;
    trackingToken = nanoid(21);
  }

  const [requestRow] = await db
    .insert(visitRequests)
    .values({
      customerName: lead.name,
      customerPhone: lead.phone,
      customerEmail: lead.email ?? null,
      address: extra.address,
      cityId: lead.cityId,
      customerState: extra.customerState ?? lead.cityState ?? null,
      bhk: extra.bhk,
      interest: lead.interest,
      trackingToken,
      source: 'lead_conversion',
      statusStageId: assignedStage.id,
      assignedExecUserId: actor.id,
      assignedCaptainUserId: cityRow?.captainUserId ?? null,
      assignedAt: now,
    })
    .returning({ id: visitRequests.id });

  // Initial status_history row — null → ASSIGNED, transition_order=1.
  await db.insert(requestStatusHistory).values({
    requestId: requestRow.id,
    fromStatusStageId: null,
    toStatusStageId: assignedStage.id,
    sequenceNumber: assignedStage.sequenceNumber,
    transitionOrder: 1,
    changedByUserId: actor.id,
    reason: 'Lead converted',
    changedAt: now,
  });

  // Mark the lead as converted.
  await db
    .update(leads)
    .set({ convertedToRequestId: requestRow.id, convertedAt: now })
    .where(eq(leads.id, input.leadId));

  // Audit trail.
  await logEvent({
    eventType: 'lead_converted_to_request',
    actorUserId: actor.id,
    actorRole: isRole(actor.role) ? actor.role : null,
    targetEntityType: 'lead',
    targetEntityId: input.leadId,
    afterState: { requestId: requestRow.id, trackingToken },
  });

  // Notification stub — captain gets notified when one of their team's
  // execs converts a lead. HVA-79 will wire the real in-app
  // notification + SSE; today this is just a structured log line so we
  // can confirm the trigger fired during walks.
  log.info(
    {
      component: 'leads.conversion',
      execUserId: actor.id,
      execName: actor.fullName ?? null,
      leadId: input.leadId,
      requestId: requestRow.id,
      cityCaptainUserId: cityRow?.captainUserId ?? null,
      msg: 'lead_converted_captain_notify_stub_HVA-79',
    },
    'lead_converted',
  );

  revalidatePath('/', 'layout');
  return { ok: true, data: { requestId: requestRow.id } };
}
