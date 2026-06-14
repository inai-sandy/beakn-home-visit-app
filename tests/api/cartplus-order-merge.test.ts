import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST } from '@/app/api/webhooks/cartplus/route';
import { db } from '@/db/client';
import {
  cities,
  leads,
  notificationRules,
  quotations,
  requestStatusHistory,
  users,
  visitRequests,
  webhookSecrets,
} from '@/db/schema';
import { computeCartplusSignature } from '@/lib/webhooks/cartplus/verify';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
} from '../helpers/db';

// =============================================================================
// HVA-282: CartPlus order → existing-request MERGE
// =============================================================================
//
// An order attaches to the customer's NEWEST open request that has no
// quotation yet (so their existing tracking link reflects it). A second
// order finds no candidate (the first claimed it) and creates a new
// request. No prior request → new request (unchanged).
// =============================================================================

const TEST_SECRET = 'cartplus_282_test_secret_cccccccccccccccccccccccccc';

let counter = 0;
function uniq(): string {
  counter += 1;
  return String(1000 + counter).padStart(4, '0');
}

beforeEach(async () => {
  await db
    .insert(notificationRules)
    .values([
      {
        eventType: 'webhook.cartplus.order_received',
        channel: 'in_app',
        recipientRole: 'exec_assigned',
        enabled: true,
        templateKey: null,
      },
    ])
    .onConflictDoNothing();
});

async function seedActiveSecret(): Promise<void> {
  const admin = await seedSuperAdmin({ phone: `+9199857${uniq()}` });
  await db.insert(webhookSecrets).values({
    provider: 'cartplus',
    secret: TEST_SECRET,
    secretPreview: `${TEST_SECRET.slice(0, 4)}…${TEST_SECRET.slice(-4)}`,
    createdByUserId: admin.id,
  });
}

async function seedMappedCityAndExec(storeId: number, portalExecId: number) {
  await seedActiveSecret();
  const captain = await seedCaptain({ phone: `+9199856${uniq()}` });
  const exec = await seedExecutive(captain.id, { phone: `+9199856${uniq()}`, fullName: 'Exec H282' });
  const city = await getOrCreateCity('Bangalore');
  await db.update(cities).set({ cartplusStoreId: storeId }).where(eq(cities.id, city.id));
  await db.update(users).set({ portalExecId }).where(eq(users.id, exec.id));
  return { execId: exec.id, cityId: city.id };
}

function envelope(opts: {
  eventId: string;
  type?: string;
  status?: string;
  storeId: number;
  portalExecId: number;
  portalOrderId: number;
  phone: string;
  total: number;
}): Record<string, unknown> {
  return {
    id: opts.eventId,
    type: opts.type ?? 'order.created',
    store: { id: opts.storeId, slug: 'test', name: 'Test' },
    data: {
      order: {
        id: opts.portalOrderId,
        order_number: `CP-${opts.portalOrderId}`,
        status: opts.status ?? 'confirmed',
        payment_status: 'paid',
        fulfillment_status: 'pending',
        currency: 'INR',
        total_amount: opts.total,
        placed_at: '2026-06-10T10:00:00Z',
        items: [
          { id: opts.portalOrderId * 10 + 1, product_id: 1, name: 'Curtain', sku: 'C1', unit_price: opts.total, quantity: 1, line_total: opts.total, notes: null },
        ],
        created_by: { id: opts.portalExecId, name: 'Exec H282', email: null },
        customer: { id: 301, name: 'Merge Customer', phone: opts.phone, email: null },
      },
    },
    created_at: '2026-06-10T10:30:00Z',
  };
}

function fire(env: Record<string, unknown>, eventType = 'order.created'): Promise<Response> {
  const body = JSON.stringify(env);
  const sig = computeCartplusSignature(TEST_SECRET, body);
  return POST(
    new Request('https://visits.beakn.in/api/webhooks/cartplus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cartplus-signature': sig,
        'x-cartplus-event': eventType,
        'x-cartplus-delivery': `dlv_${Math.random()}`,
      },
      body,
    }) as never,
  );
}

/** Seed a customer-raised web request (contact + request, no quotation). */
async function seedWebRequest(phone: string, cityId: string, execId: string) {
  const [lead] = await db
    .insert(leads)
    .values({
      type: 'Customer',
      name: 'Merge Customer',
      phone,
      interest: [],
      cityId,
      capturedByUserId: execId,
    })
    .returning({ id: leads.id });
  const submitted = await getStatusStage('SUBMITTED');
  const [req] = await db
    .insert(visitRequests)
    .values({
      customerName: 'Merge Customer',
      customerPhone: phone,
      address: 'web addr',
      cityId,
      bhk: '3BHK',
      interest: [],
      trackingToken: `web_${Math.random().toString(36).slice(2, 18)}`,
      source: 'web',
      contactId: lead.id,
      statusStageId: submitted.id,
    })
    .returning({ id: visitRequests.id });
  return { contactId: lead.id, requestId: req.id };
}

describe('HVA-282: order merges into the existing request', () => {
  it('order #1 attaches to the customer web request (no new request); status → QUOTATION_GIVEN', async () => {
    const { execId, cityId } = await seedMappedCityAndExec(9301, 5301);
    const phone = `+9198${uniq()}0000`;
    const { contactId, requestId } = await seedWebRequest(phone, cityId, execId);

    const res = await fire(envelope({ eventId: 'evt_m1', storeId: 9301, portalExecId: 5301, portalOrderId: 8301, phone, total: 1000 }));
    expect(res.status).toBe(200);

    // No NEW request — still exactly one request under the contact.
    const reqs = await db.select({ id: visitRequests.id }).from(visitRequests).where(eq(visitRequests.contactId, contactId));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.id).toBe(requestId);

    // The web request now carries the portal quotation.
    const [q] = await db.select({ rid: quotations.visitRequestId, src: quotations.source }).from(quotations).where(eq(quotations.portalQuotationId, '8301'));
    expect(q!.rid).toBe(requestId);
    expect(q!.src).toBe('portal');

    // Status advanced to QUOTATION_GIVEN with a history row.
    const qg = await getStatusStage('QUOTATION_GIVEN');
    const [reqNow] = await db.select({ stage: visitRequests.statusStageId }).from(visitRequests).where(eq(visitRequests.id, requestId));
    expect(reqNow!.stage).toBe(qg.id);
    const hist = await db.select({ to: requestStatusHistory.toStatusStageId }).from(requestStatusHistory).where(eq(requestStatusHistory.requestId, requestId));
    expect(hist.some((h) => h.to === qg.id)).toBe(true);
  });

  it('order #2 for the same customer creates a SECOND request', async () => {
    const { execId, cityId } = await seedMappedCityAndExec(9302, 5302);
    const phone = `+9197${uniq()}0000`;
    const { contactId } = await seedWebRequest(phone, cityId, execId);

    await fire(envelope({ eventId: 'evt_m2a', storeId: 9302, portalExecId: 5302, portalOrderId: 8302, phone, total: 1000 }));
    await fire(envelope({ eventId: 'evt_m2b', storeId: 9302, portalExecId: 5302, portalOrderId: 8303, phone, total: 2000 }));

    // First merged into the web request; second created a new one → 2 total.
    const reqs = await db.select({ id: visitRequests.id }).from(visitRequests).where(eq(visitRequests.contactId, contactId));
    expect(reqs).toHaveLength(2);

    // Each order has its own quotation on a distinct request.
    const [q1] = await db.select({ rid: quotations.visitRequestId }).from(quotations).where(eq(quotations.portalQuotationId, '8302'));
    const [q2] = await db.select({ rid: quotations.visitRequestId }).from(quotations).where(eq(quotations.portalQuotationId, '8303'));
    expect(q1!.rid).not.toBe(q2!.rid);
  });

  it('no existing request → creates a new request (unchanged)', async () => {
    const { } = await seedMappedCityAndExec(9303, 5303);
    const phone = `+9196${uniq()}0000`;
    const res = await fire(envelope({ eventId: 'evt_m3', storeId: 9303, portalExecId: 5303, portalOrderId: 8304, phone, total: 1500 }));
    expect(res.status).toBe(200);

    const [q] = await db.select({ rid: quotations.visitRequestId }).from(quotations).where(eq(quotations.portalQuotationId, '8304'));
    expect(q).toBeDefined();
    const [req] = await db.select({ source: visitRequests.source }).from(visitRequests).where(eq(visitRequests.id, q!.rid));
    expect(req!.source).toBe('portal');
  });
});

describe('HVA-282: reactivation — a CartPlus update on a cancelled request un-cancels it', () => {
  it('order.cancelled then order.status_changed clears cancelled_at', async () => {
    await seedMappedCityAndExec(9401, 5401);
    const phone = `+9195${uniq()}0000`;

    // created → request at QUOTATION_GIVEN
    await fire(envelope({ eventId: 'evt_r1', storeId: 9401, portalExecId: 5401, portalOrderId: 8401, phone, total: 1000 }));
    const [q] = await db.select({ rid: quotations.visitRequestId }).from(quotations).where(eq(quotations.portalQuotationId, '8401'));
    const requestId = q!.rid;

    // cancel → cancelled_at set
    await fire(
      envelope({ eventId: 'evt_r2', type: 'order.cancelled', status: 'cancelled', storeId: 9401, portalExecId: 5401, portalOrderId: 8401, phone, total: 1000 }),
      'order.cancelled',
    );
    const [afterCancel] = await db.select({ c: visitRequests.cancelledAt }).from(visitRequests).where(eq(visitRequests.id, requestId));
    expect(afterCancel!.c).not.toBeNull();

    // status_changed (active) → reactivated, cancelled_at cleared, value updated
    await fire(
      envelope({ eventId: 'evt_r3', type: 'order.status_changed', status: 'confirmed', storeId: 9401, portalExecId: 5401, portalOrderId: 8401, phone, total: 1800 }),
      'order.status_changed',
    );
    const [afterReactivate] = await db.select({ c: visitRequests.cancelledAt }).from(visitRequests).where(eq(visitRequests.id, requestId));
    expect(afterReactivate!.c).toBeNull();
    const [qv] = await db.select({ paise: quotations.totalOrderValuePaise }).from(quotations).where(eq(quotations.portalQuotationId, '8401'));
    expect(qv!.paise).toBe(180000);
  });
});
