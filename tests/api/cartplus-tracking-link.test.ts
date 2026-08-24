import { and, desc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { POST } from '@/app/api/webhooks/cartplus/route';
import { db } from '@/db/client';
import {
  auditLog,
  cities,
  leads,
  notificationRules,
  quotations,
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
// HVA-345: the customer of a CartPlus order gets their tracking link
// =============================================================================
//
// A CartPlus order that creates a new request has always minted a tracking
// token and never told the customer it existed. Their /track page renders the
// order copy — items, order value, tax breakdown — so the page was live and
// unreachable. HVA-282 recorded the reason as "blocked on a Meta-approved
// template", which went stale: `tracking_link_confirmation` was approved
// 2026-05-31 and has been sending on the web door ever since.
//
// Two ways this goes wrong, one test each:
//
//   1. CartPlus sends '+91 77788 85566'. The raw value is what gets stored on
//      the row, and the provider needs E.164 with no spaces — send the raw
//      string and the message silently does not arrive.
//   2. A MERGED order lands on a request the customer already holds a link
//      for. Sending again is a second link for one job.
// =============================================================================

const TEST_SECRET = 'cartplus_345_test_secret_dddddddddddddddddddddddddd';
const STORE_ID = 34501;

let counter = 0;
function uniq(): string {
  counter += 1;
  return String(2000 + counter).padStart(4, '0');
}

beforeEach(async () => {
  // truncateAll() wipes notification_rules between tests, so the rule
  // migration 0094 seeds has to be re-seeded here or the engine matches
  // nothing and every assertion below passes vacuously.
  await db
    .insert(notificationRules)
    .values([
      {
        eventType: 'webhook.cartplus.tracking_link_issued',
        channel: 'whatsapp',
        recipientRole: 'customer',
        enabled: true,
        templateKey: 'tracking_link_confirmation',
      },
    ])
    .onConflictDoNothing();
});

async function seedEnvironment(portalExecId: number) {
  const admin = await seedSuperAdmin({ phone: `+9199857${uniq()}` });
  await db.insert(webhookSecrets).values({
    provider: 'cartplus',
    secret: TEST_SECRET,
    secretPreview: `${TEST_SECRET.slice(0, 4)}…${TEST_SECRET.slice(-4)}`,
    createdByUserId: admin.id,
  });
  const captain = await seedCaptain({ phone: `+9199856${uniq()}` });
  const exec = await seedExecutive(captain.id, {
    phone: `+9199856${uniq()}`,
    fullName: 'Exec H345',
  });
  const city = await getOrCreateCity('Bangalore');
  await db.update(cities).set({ cartplusStoreId: STORE_ID }).where(eq(cities.id, city.id));
  await db.update(users).set({ portalExecId }).where(eq(users.id, exec.id));
  return { cityId: city.id, execId: exec.id };
}

function envelope(opts: {
  eventId: string;
  portalExecId: number;
  portalOrderId: number;
  phone: string;
}): Record<string, unknown> {
  return {
    id: opts.eventId,
    type: 'order.created',
    store: { id: STORE_ID, slug: 'test', name: 'Test' },
    data: {
      order: {
        id: opts.portalOrderId,
        order_number: `CP-${opts.portalOrderId}`,
        status: 'pending',
        payment_status: 'paid',
        fulfillment_status: 'pending',
        currency: 'INR',
        total_amount: 2337,
        placed_at: '2026-08-21T10:00:00Z',
        items: [
          {
            id: opts.portalOrderId * 10 + 1,
            product_id: 1,
            name: 'Smart Plug - 16A',
            sku: 'PNP003',
            unit_price: 2337,
            quantity: 1,
            line_total: 2337,
            notes: null,
          },
        ],
        created_by: { id: opts.portalExecId, name: 'Exec H345', email: null },
        customer: { id: 661, name: 'Vikas Sharma', phone: opts.phone, email: null },
      },
    },
    created_at: '2026-08-21T10:00:30Z',
  };
}

function fire(env: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(env);
  const sig = computeCartplusSignature(TEST_SECRET, body);
  return POST(
    new Request('https://visits.beakn.in/api/webhooks/cartplus', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cartplus-signature': sig,
        'x-cartplus-event': 'order.created',
        'x-cartplus-delivery': `dlv_${Math.random()}`,
      },
      body,
    }) as never,
  );
}

/**
 * The whatsapp deliveries recorded for the tracking-link event on ONE request.
 *
 * Scoped by request id rather than reading every dispatch row, because the
 * handler fires notifications fire-and-forget: a previous test's dispatch can
 * land after its own afterEach TRUNCATE and surface inside the next test's
 * window. Filtering on the request under test makes each assertion immune to
 * that race instead of asserting on whatever happens to be in the table.
 */
async function trackingLinkDeliveries(requestId: string): Promise<
  Array<{ channel: string; resolvedTarget: string | null; status: string }>
> {
  const rows = await db
    .select({ afterState: auditLog.afterState })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.eventType, 'notification_dispatched'),
        eq(auditLog.targetEntityId, requestId),
      ),
    )
    .orderBy(desc(auditLog.createdAt));
  const out: Array<{ channel: string; resolvedTarget: string | null; status: string }> = [];
  for (const row of rows) {
    const state = row.afterState as Record<string, unknown> | null;
    if (!state || state.event !== 'webhook.cartplus.tracking_link_issued') continue;
    for (const d of (state.deliveries ?? []) as Array<Record<string, unknown>>) {
      out.push({
        channel: String(d.channel),
        resolvedTarget: (d.resolvedTarget as string | null) ?? null,
        status: String(d.status),
      });
    }
  }
  return out;
}

/**
 * Block until the order-received dispatch for this request has been recorded.
 *
 * Notifications are fired fire-and-forget, so "no tracking link was sent" is
 * indistinguishable from "it has not been written yet" unless the test waits
 * for a dispatch it KNOWS must happen. `webhook.cartplus.order_received` is
 * issued immediately before the tracking-link send in the same block, so once
 * its row exists the negative assertion is meaningful rather than a race.
 */
async function waitForOrderReceived(requestId: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const rows = await db
      .select({ afterState: auditLog.afterState })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'notification_dispatched'),
          eq(auditLog.targetEntityId, requestId),
        ),
      );
    if (
      rows.some(
        (r) =>
          (r.afterState as Record<string, unknown> | null)?.event ===
          'webhook.cartplus.order_received',
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('order_received dispatch never landed — cannot trust a negative assertion');
}

/**
 * The request a given CartPlus order landed on, found through its quotation.
 *
 * Deliberately NOT "the newest request" or "count all requests": notifications
 * are fire-and-forget, so a neighbouring test's async write can land after its
 * own afterEach TRUNCATE and sit in this test's window. A global query then
 * reads somebody else's row and the assertion fails for a reason that has
 * nothing to do with what is being tested. Scoping to the order under test
 * makes these assertions immune to that.
 */
async function requestForOrder(portalOrderId: number): Promise<string | null> {
  const [q] = await db
    .select({ requestId: quotations.visitRequestId })
    .from(quotations)
    .where(eq(quotations.portalQuotationId, String(portalOrderId)));
  return q?.requestId ?? null;
}

describe('HVA-345: CartPlus tracking link to the customer', () => {
  it('sends the link, and normalises the spaced phone CartPlus supplies', async () => {
    await seedEnvironment(345_001);
    const res = await fire(
      envelope({
        eventId: 'evt-345-new',
        portalExecId: 345_001,
        portalOrderId: 34_510,
        // Exactly the shape a real CartPlus payload carries.
        phone: '+91 77788 85566',
      }),
    );
    expect(res.status).toBe(200);

    const createdId = await requestForOrder(34_510);
    expect(createdId, 'the order should have created a request').toBeTruthy();
    const deliveries = await trackingLinkDeliveries(createdId!);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channel).toBe('whatsapp');
    // The load-bearing assertion: no spaces, E.164. Passing through the raw
    // '+91 77788 85566' would resolve a target the provider cannot deliver to.
    expect(deliveries[0].resolvedTarget).toBe('+917778885566');
    expect(deliveries[0].status).not.toBe('skipped');
  });

  it('mints a tracking token on the new request so the link resolves', async () => {
    await seedEnvironment(345_002);
    await fire(
      envelope({
        eventId: 'evt-345-token',
        portalExecId: 345_002,
        portalOrderId: 34_520,
        phone: '+91 77788 85567',
      }),
    );
    const createdId = await requestForOrder(34_520);
    expect(createdId, 'the order should have created a request').toBeTruthy();
    const [row] = await db
      .select({ token: visitRequests.trackingToken })
      .from(visitRequests)
      .where(eq(visitRequests.id, createdId!));
    expect(row?.token).toBeTruthy();
    expect(row!.token!.length).toBeGreaterThan(8);
  });

  it('stays silent when the order MERGES onto a request the customer already tracks', async () => {
    const { cityId, execId } = await seedEnvironment(345_003);
    const phone = '+917778885568';

    // A web request the customer already raised — and already holds a link for.
    const [lead] = await db
      .insert(leads)
      .values({
        type: 'Customer',
        name: 'Vikas Sharma',
        phone,
        interest: [],
        cityId,
        capturedByUserId: execId,
      })
      .returning({ id: leads.id });
    const submitted = await getStatusStage('SUBMITTED');
    await db.insert(visitRequests).values({
      customerName: 'Vikas Sharma',
      customerPhone: phone,
      address: 'web addr',
      cityId,
      bhk: '3BHK',
      interest: [],
      trackingToken: 'existing-token-345',
      source: 'web',
      contactId: lead.id,
      statusStageId: submitted.id,
    });

    const res = await fire(
      envelope({
        eventId: 'evt-345-merge',
        portalExecId: 345_003,
        portalOrderId: 34_530,
        phone: '+91 77788 85568',
      }),
    );
    expect(res.status).toBe(200);

    // Guard the premise: if the order did not actually merge, the silence
    // assertion below would pass for the wrong reason.
    const reqs = await db
      .select({ id: visitRequests.id, token: visitRequests.trackingToken })
      .from(visitRequests)
      // Scoped to this customer — a neighbouring test's leaked row must not
      // read as "the order created a second request".
      .where(eq(visitRequests.customerPhone, phone));
    expect(reqs, 'order should have merged, not created a second request').toHaveLength(1);
    expect(reqs[0].token).toBe('existing-token-345');

    await waitForOrderReceived(reqs[0].id);

    // The order merged onto the existing request, so no second link goes out.
    expect(await trackingLinkDeliveries(reqs[0].id)).toHaveLength(0);
  });
});
