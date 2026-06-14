import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '@/db/client';
import {
  cities,
  leads,
  quotationLineItems,
  quotations,
  requestStatusHistory,
  statusStages,
  users,
  visitRequests,
  webhookEvents,
} from '@/db/schema';
import { log } from '@/lib/logger';
import { normalizeIndianPhone, toStorageFormat } from '@/lib/phone';

import type { CartplusEnvelope } from './envelope';
import { cartplusOrderEventDataSchema } from './order-payload';

// drizzle's tx callback signature — same pattern as lib/status-transition.ts
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// =============================================================================
// HVA-250 (HVA-230 Phase 2.A): handler for `order.created`
// =============================================================================
//
// Called by the receiver in app/api/webhooks/cartplus/route.ts after the
// envelope has been HMAC-verified and stored in webhook_events with
// initial result='noop'. This handler:
//
//   1. Parses data.order (Zod)
//   2. Resolves city via cities.cartplus_store_id (fallback: 'Other')
//   3. Resolves exec via users.portal_exec_id (fallback: null = unassigned)
//   4. Finds or creates a contact (leads) by phone — when an exec is
//      resolved, they become the captor; otherwise we use the system
//      admin since leads.captured_by_user_id is NOT NULL
//   5. Creates the visit_request at QUOTATION_GIVEN
//   6. Creates the quotation (source='portal') + line items
//   7. Emits notifications via dispatchNotification(eventType=...)
//   8. Marks the webhook_events row result='ok'
//
// On error: the row stays at 'noop' from the receiver, but we UPDATE it
// to 'error' with the message before re-throwing — the receiver translates
// the throw into a 5xx so CartPlus retries.
// =============================================================================

const handlerLog = log.child({ component: 'webhooks.cartplus.handler' });

export const PORTAL_ORDER_RECEIVED_EVENT = 'webhook.cartplus.order_received';
const QUOTATION_GIVEN_CODE = 'QUOTATION_GIVEN';
const OTHER_CITY_NAME = 'Other';
const TOKEN_LEN = 16;
const PORTAL_ADDRESS_PLACEHOLDER = 'Portal order — address pending';

export interface HandlerOutcome {
  status: 'ok' | 'error' | 'skipped';
  requestId?: string;
  reason?: string;
}

export async function handleCartplusOrderCreated(
  envelope: CartplusEnvelope,
  webhookEventId: string,
): Promise<HandlerOutcome> {
  // 1. Parse data.order
  const parsed = cartplusOrderEventDataSchema.safeParse(envelope.data);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}:${i.message}`)
      .join('; ');
    await markEvent(webhookEventId, 'error', issues);
    handlerLog.warn(
      { webhookEventId, eventId: envelope.id, issues },
      'order_payload_parse_failed',
    );
    return { status: 'error', reason: issues };
  }

  const order = parsed.data.order;
  const storeId = envelope.store.id;

  try {
    // 2. Resolve city via store.id
    const cityResult = await resolveCity(storeId);
    if (cityResult.fallback) {
      handlerLog.warn(
        { webhookEventId, storeId, cityId: cityResult.cityId },
        'city_unmapped_falling_back_to_other',
      );
    }

    // 3. Resolve exec via created_by.id
    const execResult = await resolveExec(order.created_by?.id ?? null);
    if (execResult.fallback) {
      handlerLog.warn(
        {
          webhookEventId,
          portalExecId: order.created_by?.id ?? null,
          reason: execResult.reason,
        },
        'exec_unresolved',
      );
    }

    // 4. Find-or-create contact + 5. Create visit_request + 6. Quotation
    //    All in a single transaction so partial states aren't possible.
    const result = await db.transaction(async (tx) => {
      // Stage lookup (cached miss is rare in production)
      const [stage] = await tx
        .select({ id: statusStages.id, seq: statusStages.sequenceNumber })
        .from(statusStages)
        .where(eq(statusStages.code, QUOTATION_GIVEN_CODE))
        .limit(1);
      if (!stage) {
        throw new Error(`status stage '${QUOTATION_GIVEN_CODE}' not seeded`);
      }

      // 4a. Contact lookup/create
      const capturerUserId =
        execResult.userId ?? (await resolveSystemCapturer(tx));
      const contactId = await findOrCreateLead(tx, {
        name: order.customer.name,
        phone: order.customer.phone,
        email: order.customer.email ?? null,
        cityId: cityResult.cityId,
        capturedByUserId: capturerUserId,
      });

      const now = new Date();
      const totalPaise = Math.round(order.total_amount * 100);

      // 4b. HVA-282: try to MERGE this order into the customer's newest
      //     open request that has no quotation yet (the one they raised /
      //     are being worked), so their existing tracking link reflects
      //     this order. Candidates: same contact, not cancelled, at or
      //     before QUOTATION_GIVEN, and with NO quotation row. A second
      //     order for the same customer finds none (the first order
      //     claimed it — it now has a quotation) and falls through to a
      //     brand-new request, which is exactly the desired behaviour.
      const [mergeTarget] = await tx
        .select({
          id: visitRequests.id,
          currentStageId: visitRequests.statusStageId,
          currentSeq: statusStages.sequenceNumber,
        })
        .from(visitRequests)
        .innerJoin(
          statusStages,
          eq(statusStages.id, visitRequests.statusStageId),
        )
        .where(
          and(
            eq(visitRequests.contactId, contactId),
            isNull(visitRequests.cancelledAt),
            lte(statusStages.sequenceNumber, stage.seq),
            sql`NOT EXISTS (SELECT 1 FROM ${quotations} q WHERE q.visit_request_id = ${visitRequests.id})`,
          ),
        )
        .orderBy(desc(visitRequests.createdAt))
        .limit(1);

      let requestId: string;
      let merged: boolean;

      if (mergeTarget) {
        requestId = mergeTarget.id;
        merged = true;
        // Advance to QUOTATION_GIVEN only if the request is behind it —
        // never move a request backward. A proper history row keeps the
        // customer /track timeline + transition-based metrics correct.
        // The existing request's exec assignment is left untouched.
        if (mergeTarget.currentSeq < stage.seq) {
          const [orderRow] = await tx
            .select({
              maxOrder: sql<number>`COALESCE(MAX(${requestStatusHistory.transitionOrder}), 0)`,
            })
            .from(requestStatusHistory)
            .where(eq(requestStatusHistory.requestId, requestId));
          await tx.insert(requestStatusHistory).values({
            requestId,
            fromStatusStageId: mergeTarget.currentStageId,
            toStatusStageId: stage.id,
            sequenceNumber: stage.seq,
            transitionOrder: Number(orderRow?.maxOrder ?? 0) + 1,
            changedByUserId: execResult.userId ?? capturerUserId,
            reason: 'CartPlus order received',
            changedAt: now,
          });
          await tx
            .update(visitRequests)
            .set({ statusStageId: stage.id, updatedAt: now })
            .where(eq(visitRequests.id, requestId));
        }
      } else {
        // 4b'. No merge target — create a brand-new request (original
        //      behaviour). The customer is sent a fresh tracking link for
        //      it via WhatsApp once the Meta template is live (HVA-282
        //      follow-up — the send is wired separately).
        merged = false;
        const trackingToken = nanoid(TOKEN_LEN);
        const [requestRow] = await tx
          .insert(visitRequests)
          .values({
            customerName: order.customer.name,
            customerPhone: order.customer.phone,
            customerEmail: order.customer.email ?? null,
            address: PORTAL_ADDRESS_PLACEHOLDER,
            cityId: cityResult.cityId,
            bhk: 'Others',
            interest: [],
            trackingToken,
            source: 'portal',
            contactId,
            statusStageId: stage.id,
            assignedExecUserId: execResult.userId,
            // assigned_captain_user_id resolved by captain ownership of city
            // — captains tie to cities via cities.captain_user_id. Pull it.
            assignedCaptainUserId: cityResult.captainUserId,
            assignedAt: execResult.userId ? new Date() : null,
          })
          .returning({ id: visitRequests.id });
        requestId = requestRow.id;
      }

      // 4c. Quotation — both branches: the request had no quotation row.
      const [quotationRow] = await tx
        .insert(quotations)
        .values({
          visitRequestId: requestId,
          quotationNumber: order.order_number,
          totalOrderValuePaise: totalPaise,
          submittedByUserId: execResult.userId ?? capturerUserId,
          source: 'portal',
          portalQuotationId: String(order.id),
          rawPayload: envelope as unknown as Record<string, unknown>,
          lastWebhookAt: now,
          storeId: storeId,
        })
        .returning({ id: quotations.id });

      // 4d. Line items
      let position = 1;
      for (const item of order.items) {
        await tx.insert(quotationLineItems).values({
          quotationId: quotationRow.id,
          position: position++,
          productName: item.name,
          productSku: item.sku,
          quantity: item.quantity,
          unitPricePaise: Math.round(item.unit_price * 100),
          lineTotalPaise: Math.round(item.line_total * 100),
          notes: item.notes ?? null,
          portalProductId: item.product_id,
          portalLineItemId: item.id,
        });
      }

      return { requestId, merged };
    });

    // 7. Notifications — fire-and-forget so DB commit is the source of truth
    //    even if notification fan-out fails. Engine swallows its own errors.
    try {
      // Dynamic import — avoids circular issues at module load.
      const { dispatchNotification } = await import('@/lib/notifications/engine');
      void dispatchNotification(PORTAL_ORDER_RECEIVED_EVENT, {
        requestId: result.requestId,
        portalOrderId: String(order.id),
        orderNumber: order.order_number,
        customerName: order.customer.name,
        totalAmountInr: order.total_amount,
        execUserId: execResult.userId,
        cityId: cityResult.cityId,
        fallbackUsed: cityResult.fallback || execResult.fallback,
      });
    } catch (err) {
      handlerLog.warn(
        { webhookEventId, err: err instanceof Error ? err.message : String(err) },
        'notification_dispatch_failed',
      );
    }

    // 8. Mark event ok
    await markEvent(webhookEventId, 'ok', null);
    handlerLog.info(
      {
        webhookEventId,
        eventId: envelope.id,
        requestId: result.requestId,
        merged: result.merged,
        execResolved: Boolean(execResult.userId),
        cityFallback: cityResult.fallback,
      },
      'order_created_handled',
    );
    return { status: 'ok', requestId: result.requestId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markEvent(webhookEventId, 'error', message.slice(0, 1000));
    handlerLog.error(
      { webhookEventId, eventId: envelope.id, err: message },
      'order_created_handler_failed',
    );
    return { status: 'error', reason: message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markEvent(
  id: string,
  result: 'ok' | 'noop' | 'error',
  errorMessage: string | null,
): Promise<void> {
  try {
    await db
      .update(webhookEvents)
      .set({ result, errorMessage, processedAt: new Date() })
      .where(eq(webhookEvents.id, id));
  } catch {
    // Audit-only column update — never block the caller.
  }
}

async function resolveCity(storeId: number): Promise<{
  cityId: string;
  captainUserId: string | null;
  fallback: boolean;
}> {
  const [match] = await db
    .select({ id: cities.id, captainUserId: cities.captainUserId })
    .from(cities)
    .where(eq(cities.cartplusStoreId, storeId))
    .limit(1);
  if (match) {
    return {
      cityId: match.id,
      captainUserId: match.captainUserId,
      fallback: false,
    };
  }
  const [other] = await db
    .select({ id: cities.id, captainUserId: cities.captainUserId })
    .from(cities)
    .where(eq(cities.name, OTHER_CITY_NAME))
    .limit(1);
  if (!other) {
    throw new Error(`fallback city '${OTHER_CITY_NAME}' not seeded`);
  }
  return {
    cityId: other.id,
    captainUserId: other.captainUserId,
    fallback: true,
  };
}

async function resolveExec(
  portalExecId: number | null,
): Promise<{
  userId: string | null;
  fallback: boolean;
  reason?: string;
}> {
  if (portalExecId === null) {
    return { userId: null, fallback: true, reason: 'no_created_by' };
  }
  const [match] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.portalExecId, portalExecId), eq(users.isActive, true)))
    .limit(1);
  if (!match) {
    return { userId: null, fallback: true, reason: 'unmapped_portal_exec_id' };
  }
  return { userId: match.id, fallback: false };
}

// leads.captured_by_user_id is NOT NULL with ON DELETE RESTRICT. When the
// webhook can't resolve a CartPlus exec to an HVA user, we still need
// someone to "own" the contact. Use the lowest-id active super_admin as
// the system capturer.
async function resolveSystemCapturer(
  tx: DbTx,
): Promise<string> {
  const [admin] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'super_admin'), eq(users.isActive, true)))
    .orderBy(sql`${users.createdAt}`)
    .limit(1);
  if (!admin) {
    throw new Error('No active super_admin to capture portal-origin contact');
  }
  return admin.id;
}

async function findOrCreateLead(
  tx: DbTx,
  input: {
    name: string;
    phone: string;
    email: string | null;
    cityId: string;
    capturedByUserId: string;
  },
): Promise<string> {
  const normalised = normalizeIndianPhone(input.phone);
  const storage = normalised ? toStorageFormat(normalised) : null;
  if (!storage) {
    // Phone unparseable — still record the lead with the raw phone so the
    // contact has a row. Future cleanup will normalise.
    const [row] = await tx
      .insert(leads)
      .values({
        type: 'Customer',
        name: input.name,
        phone: input.phone.slice(0, 15),
        email: input.email,
        cityId: input.cityId,
        interest: [],
        capturedByUserId: input.capturedByUserId,
      })
      .returning({ id: leads.id });
    return row.id;
  }
  const [existing] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.phone, storage))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await tx
    .insert(leads)
    .values({
      type: 'Customer',
      name: input.name,
      phone: storage,
      email: input.email,
      cityId: input.cityId,
      interest: [],
      capturedByUserId: input.capturedByUserId,
    })
    .returning({ id: leads.id });
  return created.id;
}

// Used by the receiver to mark events the handler hasn't been wired for.
export async function markEventNoop(webhookEventId: string): Promise<void> {
  await markEvent(webhookEventId, 'noop', null);
}

// Used by the receiver to mark error.
export { markEvent as markWebhookEvent };
