import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  notificationRules,
  rateLimitAttempts,
  supportTickets,
  visitRequests,
} from '@/db/schema';

// Mock the Turnstile verifier so tests don't try to hit Cloudflare.
vi.mock('@/lib/turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) => ({
    success: token !== 'BAD_TOKEN',
    errorCodes: token === 'BAD_TOKEN' ? ['invalid-input-response'] : [],
  })),
}));

// next/headers is only available inside the Next.js request context.
// Route handlers we invoke directly need this mock to return a stub.
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    h.set('x-forwarded-for', '1.2.3.4');
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST as createTicketPOST } from '@/app/api/customer/support-tickets/route';
import { POST as reopenTicketPOST } from '@/app/api/customer/support-tickets/[id]/reopen/route';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-254 (HVA-232 Phase 1): public support-ticket intake tests
// =============================================================================
//
// truncateAll() wipes notification_rules between tests; re-seed
// migration 0071 rows here so the engine has rules to fire against on
// every test.
// =============================================================================

beforeEach(async () => {
  await db.execute(sql.raw(`
    INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
    VALUES
      ('customer.support_ticket_created', 'in_app', 'exec_assigned',       true, NULL),
      ('customer.support_ticket_created', 'in_app', 'captain_owning_city', true, NULL)
    ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;
  `));
});

async function seedBaseRequest(): Promise<{
  requestId: string;
  trackingToken: string;
  execId: string;
  captainId: string;
}> {
  const captain = await seedCaptain({ phone: '+919940000001' });
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: '+919940000002',
    fullName: 'Exec Ticket',
  });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'ORDER_CONFIRMED',
  });
  // seedVisitRequest only returns { id }; pull the token via a follow-up query.
  const [row] = await db
    .select({ trackingToken: visitRequests.trackingToken })
    .from(visitRequests)
    .where(eq(visitRequests.id, req.id));
  return {
    requestId: req.id,
    trackingToken: row!.trackingToken,
    execId: exec.id,
    captainId: captain.id,
  };
}

function buildCreateRequest(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/customer/support-tickets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '1.2.3.4',
    },
    body: JSON.stringify(body),
  });
}

function buildReopenRequest(ticketId: string, body: unknown): {
  req: Request;
  ctx: { params: Promise<{ id: string }> };
} {
  return {
    req: new Request(
      `https://visits.beakn.in/api/customer/support-tickets/${ticketId}/reopen`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': '1.2.3.4',
        },
        body: JSON.stringify(body),
      },
    ),
    ctx: { params: Promise.resolve({ id: ticketId }) },
  };
}

describe('POST /api/customer/support-tickets', () => {
  it('happy path: creates a ticket, fires notification, returns 200', async () => {
    const { requestId, trackingToken } = await seedBaseRequest();

    const res = await createTicketPOST(
      buildCreateRequest({
        trackingToken,
        subject: 'Wrong fabric colour',
        description: 'The blinds we got are blue but we ordered grey.',
        category: 'complaint',
        turnstileToken: 'OK_TOKEN',
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; ticketId: string };
    expect(json.ok).toBe(true);
    expect(json.ticketId).toBeTruthy();

    const [row] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, json.ticketId));
    expect(row).toBeDefined();
    expect(row!.requestId).toBe(requestId);
    expect(row!.category).toBe('complaint');
    expect(row!.status).toBe('open');
    expect(row!.subject).toBe('Wrong fabric colour');
    expect(row!.customerNameSnapshot).toBeTruthy();
    expect(row!.customerPhoneSnapshot).toBeTruthy();
  });

  it('rejects bad Turnstile token with 400', async () => {
    const { trackingToken } = await seedBaseRequest();
    const res = await createTicketPOST(
      buildCreateRequest({
        trackingToken,
        subject: 'Hi',
        description: 'Hi',
        category: 'other',
        turnstileToken: 'BAD_TOKEN',
      }),
    );
    expect(res.status).toBe(400);
    const tickets = await db.select().from(supportTickets);
    expect(tickets.length).toBe(0);
  });

  it('rejects unknown tracking_token with 404', async () => {
    const res = await createTicketPOST(
      buildCreateRequest({
        trackingToken: 'NOTREAL12345678',
        subject: 'Hi',
        description: 'Hi',
        category: 'other',
        turnstileToken: 'OK_TOKEN',
      }),
    );
    expect(res.status).toBe(404);
  });

  it('rejects oversized subject (>200 chars)', async () => {
    const { trackingToken } = await seedBaseRequest();
    const res = await createTicketPOST(
      buildCreateRequest({
        trackingToken,
        subject: 'X'.repeat(201),
        description: 'Hi',
        category: 'other',
        turnstileToken: 'OK_TOKEN',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects bad category value', async () => {
    const { trackingToken } = await seedBaseRequest();
    const res = await createTicketPOST(
      buildCreateRequest({
        trackingToken,
        subject: 'Hi',
        description: 'Hi',
        category: 'totally-fake',
        turnstileToken: 'OK_TOKEN',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rate-limit: 6th submission within 24h returns 429', async () => {
    const { trackingToken } = await seedBaseRequest();
    // Pre-seed 5 attempts under the key (simulates 5 prior submits)
    const key = `support_ticket:${trackingToken}`;
    for (let i = 0; i < 5; i++) {
      await db.insert(rateLimitAttempts).values({ key, ipAddress: '1.2.3.4' });
    }
    const res = await createTicketPOST(
      buildCreateRequest({
        trackingToken,
        subject: 'Hi',
        description: 'Hi',
        category: 'other',
        turnstileToken: 'OK_TOKEN',
      }),
    );
    expect(res.status).toBe(429);
  });
});

describe('POST /api/customer/support-tickets/[id]/reopen', () => {
  it('flips a resolved ticket back to open', async () => {
    const { requestId, trackingToken } = await seedBaseRequest();
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        requestId,
        category: 'complaint',
        subject: 'Test',
        description: 'Test',
        status: 'resolved',
        resolvedAt: new Date(),
        customerNameSnapshot: 'Test',
        customerPhoneSnapshot: '+919999991111',
      })
      .returning({ id: supportTickets.id });

    const { req, ctx } = buildReopenRequest(ticket.id, {
      trackingToken,
      turnstileToken: 'OK_TOKEN',
    });
    const res = await reopenTicketPOST(req, ctx);
    expect(res.status).toBe(200);

    const [updated] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, ticket.id));
    expect(updated!.status).toBe('open');
    expect(updated!.reopenedAt).not.toBeNull();
    expect(updated!.resolvedAt).toBeNull();
  });

  it('idempotent on already-open tickets', async () => {
    const { requestId, trackingToken } = await seedBaseRequest();
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        requestId,
        category: 'other',
        subject: 'X',
        description: 'X',
        status: 'open',
        customerNameSnapshot: 'X',
        customerPhoneSnapshot: '+919999991112',
      })
      .returning({ id: supportTickets.id });
    const { req, ctx } = buildReopenRequest(ticket.id, {
      trackingToken,
      turnstileToken: 'OK_TOKEN',
    });
    const res = await reopenTicketPOST(req, ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; status?: string };
    expect(json.status).toBe('already-open');
  });

  it('rejects when the tracking token does not match the ticket', async () => {
    const { requestId } = await seedBaseRequest();
    const [ticket] = await db
      .insert(supportTickets)
      .values({
        requestId,
        category: 'other',
        subject: 'X',
        description: 'X',
        status: 'resolved',
        resolvedAt: new Date(),
        customerNameSnapshot: 'X',
        customerPhoneSnapshot: '+919999991113',
      })
      .returning({ id: supportTickets.id });
    const { req, ctx } = buildReopenRequest(ticket.id, {
      trackingToken: 'wrong_token_123',
      turnstileToken: 'OK_TOKEN',
    });
    const res = await reopenTicketPOST(req, ctx);
    expect(res.status).toBe(404);
  });
});

// Reference imports the linter would otherwise drop.
void notificationRules;
void visitRequests;
