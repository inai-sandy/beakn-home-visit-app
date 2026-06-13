import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  auditLog,
  cities,
  quotations,
  supportTickets,
  visitRequests,
} from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST as paymentsPOST } from '@/app/api/requests/[id]/payments/route';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-256 (HVA-232 Phase 3): refund auto-close
// =============================================================================
//
// When a captain records an OUTBOUND payment (refund) on a request that
// has an open or in_progress refund-category ticket, the ticket auto-
// resolves. Other categories (complaint/warranty/other) are NOT touched.
// =============================================================================

async function seedRequestReadyForRefund(): Promise<{
  requestId: string;
  captainPhone: string;
  captainPassword: string;
  captainId: string;
}> {
  const captain = await seedCaptain({ phone: '+919960000001' });
  const city = await getOrCreateCity('Bangalore');
  // The refund route's per-row authz checks cities.captain_user_id;
  // wire our captain to the city or the test will 403.
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const exec = await seedExecutive(captain.id, {
    phone: '+919960000002',
    fullName: 'Exec Refund',
  });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'ORDER_CONFIRMED',
  });
  // Need a quotation row so the refund route's refund-window check passes
  // (it looks up the quotation submission date).
  await db.insert(quotations).values({
    visitRequestId: req.id,
    totalOrderValuePaise: 500000,
    source: 'portal',
    submittedByUserId: exec.id,
  });
  return {
    requestId: req.id,
    captainPhone: captain.phone,
    captainPassword: captain.password,
    captainId: captain.id,
  };
}

function buildRefundReq(amountPaise: number, label: string): Request {
  return new Request('https://visits.beakn.in/api/requests/x/payments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      direction: 'outbound',
      amountPaise,
      paymentDate: new Date().toISOString().slice(0, 10),
      mode: 'UPI',
      label,
      referenceNumber: 'TEST_REF_001',
    }),
  });
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('refund auto-close', () => {
  it('open refund ticket flips to resolved after captain records refund', async () => {
    const seed = await seedRequestReadyForRefund();

    // Pre-seed an open refund-category ticket on this request.
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        requestId: seed.requestId,
        category: 'refund',
        subject: 'Want a refund',
        description: 'Product was wrong.',
        status: 'open',
        customerNameSnapshot: 'Test Customer',
        customerPhoneSnapshot: '+919876543210',
      })
      .returning({ id: supportTickets.id });

    const sess = await loginByPhone(seed.captainPhone, seed.captainPassword);
    currentCookieHeader = sess.cookieHeader;

    const res = await paymentsPOST(
      buildRefundReq(50000, 'Refund — wrong colour'),
      buildCtx(seed.requestId),
    );
    expect(res.status).toBe(201);

    const [updated] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticket.id));
    expect(updated!.status).toBe('resolved');
    expect(updated!.resolvedAt).not.toBeNull();
    expect(updated!.resolvedByUserId).toBe(seed.captainId);

    // Audit row recorded the auto-close reason
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, ticket.id));
    const autoCloseRow = auditRows.find(
      (r) => r.eventType === 'support_ticket_resolved',
    );
    expect(autoCloseRow).toBeDefined();
    expect(autoCloseRow!.reason).toContain('refund payment');
  });

  it('in_progress refund ticket also auto-closes', async () => {
    const seed = await seedRequestReadyForRefund();
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        requestId: seed.requestId,
        category: 'refund',
        subject: 'Need refund',
        description: 'X',
        status: 'in_progress',
        claimedAt: new Date(),
        claimedByUserId: seed.captainId,
        customerNameSnapshot: 'X',
        customerPhoneSnapshot: '+919876543211',
      })
      .returning({ id: supportTickets.id });

    const sess = await loginByPhone(seed.captainPhone, seed.captainPassword);
    currentCookieHeader = sess.cookieHeader;
    const res = await paymentsPOST(
      buildRefundReq(50000, 'Refund'),
      buildCtx(seed.requestId),
    );
    expect(res.status).toBe(201);

    const [updated] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticket.id));
    expect(updated!.status).toBe('resolved');
  });

  it('non-refund tickets (complaint) on the same request are NOT touched', async () => {
    const seed = await seedRequestReadyForRefund();
    // One complaint ticket, one refund ticket
    const [complaintTicket] = await db
      .insert(supportTickets)
      .values({
        requestId: seed.requestId,
        category: 'complaint',
        subject: 'Slow delivery',
        description: 'Slow.',
        status: 'open',
        customerNameSnapshot: 'X',
        customerPhoneSnapshot: '+919876543212',
      })
      .returning({ id: supportTickets.id });
    const [refundTicket] = await db
      .insert(supportTickets)
      .values({
        requestId: seed.requestId,
        category: 'refund',
        subject: 'Refund',
        description: 'X',
        status: 'open',
        customerNameSnapshot: 'X',
        customerPhoneSnapshot: '+919876543213',
      })
      .returning({ id: supportTickets.id });

    const sess = await loginByPhone(seed.captainPhone, seed.captainPassword);
    currentCookieHeader = sess.cookieHeader;
    const res = await paymentsPOST(
      buildRefundReq(50000, 'Refund'),
      buildCtx(seed.requestId),
    );
    expect(res.status).toBe(201);

    const [refundAfter] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, refundTicket.id));
    expect(refundAfter!.status).toBe('resolved');

    const [complaintAfter] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, complaintTicket.id));
    expect(complaintAfter!.status).toBe('open');
  });

  it('inbound payment does NOT auto-close refund tickets', async () => {
    const seed = await seedRequestReadyForRefund();
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        requestId: seed.requestId,
        category: 'refund',
        subject: 'Refund',
        description: 'X',
        status: 'open',
        customerNameSnapshot: 'X',
        customerPhoneSnapshot: '+919876543214',
      })
      .returning({ id: supportTickets.id });

    const sess = await loginByPhone(seed.captainPhone, seed.captainPassword);
    currentCookieHeader = sess.cookieHeader;

    const req = new Request(
      'https://visits.beakn.in/api/requests/x/payments',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          direction: 'inbound',
          amountPaise: 100000,
          paymentDate: new Date().toISOString().slice(0, 10),
          mode: 'UPI',
        }),
      },
    );
    const res = await paymentsPOST(req, buildCtx(seed.requestId));
    expect(res.status).toBe(201);

    const [after] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticket.id));
    expect(after!.status).toBe('open');
  });
});

// Reference imports the linter would otherwise drop.
void visitRequests;
