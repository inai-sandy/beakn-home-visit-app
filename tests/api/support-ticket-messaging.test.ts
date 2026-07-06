import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  cities,
  supportTicketMessages,
  supportTickets,
  visitRequests,
} from '@/db/schema';

// =============================================================================
// HVA-232 Phase 3 (migration 0082): two-way support ticket messaging
// =============================================================================
//
// Covers: staff replyToTicketAction (insert + scope), resolve-with-note
// (message insert + customer notify dispatch), the customer reply route
// (message insert + staff notify dispatch), and thread ordering.
//
// The notification engine is mocked so we assert the DISPATCH intent
// (event + context) deterministically rather than polling for delivery
// side effects across channels.
// =============================================================================

const dispatchMock = vi.fn(async () => ({
  eventType: '',
  rulesMatched: 0,
  deliveries: [],
  auditRowId: null,
}));
vi.mock('@/lib/notifications/engine', () => ({
  dispatchNotification: (...args: unknown[]) => dispatchMock(...args),
}));

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    h.set('x-forwarded-for', '1.2.3.4');
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('@/lib/turnstile', () => ({
  verifyTurnstile: vi.fn(async (token: string) => ({
    success: token !== 'BAD_TOKEN',
    errorCodes: token === 'BAD_TOKEN' ? ['invalid-input-response'] : [],
  })),
}));

import { POST as replyPOST } from '@/app/api/customer/support-tickets/[id]/reply/route';
import {
  claimTicketAction,
  loadTicketThreadAction,
  replyToTicketAction,
  resolveTicketAction,
} from '@/lib/support-tickets/actions';
import { loadTicketMessages } from '@/lib/support-tickets/queries';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

interface Seeded {
  ticketId: string;
  requestId: string;
  trackingToken: string;
  execId: string;
  execPhone: string;
  execPassword: string;
  captainId: string;
}

async function seedOpenTicket(
  phones: { captain: string; exec: string },
  status: 'open' | 'in_progress' | 'resolved' = 'open',
): Promise<Seeded> {
  const captain = await seedCaptain({ phone: phones.captain });
  const city = await getOrCreateCity('Bangalore');
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const exec = await seedExecutive(captain.id, {
    phone: phones.exec,
    fullName: 'Exec Msg',
    password: 'MsgTest#1',
  });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'ORDER_CONFIRMED',
  });
  const [reqRow] = await db
    .select({ trackingToken: visitRequests.trackingToken })
    .from(visitRequests)
    .where(eq(visitRequests.id, req.id));
  const [t] = await db
    .insert(supportTickets)
    .values({
      requestId: req.id,
      category: 'complaint',
      subject: 'Wrong colour',
      description: 'The blinds are blue, we ordered grey.',
      status,
      resolvedAt: status === 'resolved' ? new Date() : null,
      customerNameSnapshot: 'Test Customer',
      customerPhoneSnapshot: '+919999999999',
    })
    .returning({ id: supportTickets.id });
  return {
    ticketId: t!.id,
    requestId: req.id,
    trackingToken: reqRow!.trackingToken,
    execId: exec.id,
    execPhone: exec.phone,
    execPassword: exec.password,
    captainId: captain.id,
  };
}

beforeEach(() => {
  dispatchMock.mockClear();
  currentCookieHeader = undefined;
});

// -----------------------------------------------------------------------------
// Staff reply
// -----------------------------------------------------------------------------

describe('replyToTicketAction', () => {
  it('inserts a staff message authored by the caller', async () => {
    const t = await seedOpenTicket({
      captain: '+919961000001',
      exec: '+919961000002',
    });
    const sess = await loginByPhone(t.execPhone, t.execPassword);
    currentCookieHeader = sess.cookieHeader;

    const r = await replyToTicketAction({
      ticketId: t.ticketId,
      body: 'We are sending a replacement today.',
    });
    expect(r.ok).toBe(true);

    const rows = await db
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, t.ticketId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.authorKind).toBe('staff');
    expect(rows[0]!.authorUserId).toBe(t.execId);
    expect(rows[0]!.body).toBe('We are sending a replacement today.');
  });

  it('rejects an out-of-scope exec (IDOR) and inserts nothing', async () => {
    const t = await seedOpenTicket({
      captain: '+919961000010',
      exec: '+919961000011',
    });
    const otherCaptain = await seedCaptain({ phone: '+919961000020' });
    const outsider = await seedExecutive(otherCaptain.id, {
      phone: '+919961000021',
      fullName: 'Outsider',
      password: 'Outside#1',
    });
    const sess = await loginByPhone(outsider.phone, outsider.password);
    currentCookieHeader = sess.cookieHeader;

    const r = await replyToTicketAction({
      ticketId: t.ticketId,
      body: 'Sneaky reply',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Ticket not found');

    const rows = await db
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, t.ticketId));
    expect(rows).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Resolve with closing note → customer notify
// -----------------------------------------------------------------------------

describe('resolveTicketAction with note', () => {
  it('stores the note as a staff message and dispatches the customer notification', async () => {
    const t = await seedOpenTicket({
      captain: '+919962000001',
      exec: '+919962000002',
    });
    const sess = await loginByPhone(t.execPhone, t.execPassword);
    currentCookieHeader = sess.cookieHeader;

    await claimTicketAction({ ticketId: t.ticketId });
    const r = await resolveTicketAction({
      ticketId: t.ticketId,
      note: 'Resolved — replacement installed.',
    });
    expect(r.ok).toBe(true);

    const [ticket] = await db
      .select({ status: supportTickets.status })
      .from(supportTickets)
      .where(eq(supportTickets.id, t.ticketId));
    expect(ticket!.status).toBe('resolved');

    const rows = await db
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, t.ticketId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.authorKind).toBe('staff');
    expect(rows[0]!.body).toBe('Resolved — replacement installed.');

    // The dispatch fires inside setImmediate — let the macrotask run.
    await new Promise((resolve) => setImmediate(resolve));
    const resolvedCall = dispatchMock.mock.calls.find(
      (c) => c[0] === 'customer.support_ticket_resolved',
    );
    expect(resolvedCall).toBeDefined();
    const ctx = resolvedCall![1] as Record<string, unknown>;
    expect(ctx.ticketId).toBe(t.ticketId);
    expect(ctx.trackingToken).toBe(t.trackingToken);
  });

  it('resolves cleanly with no note (no message row)', async () => {
    const t = await seedOpenTicket({
      captain: '+919962000010',
      exec: '+919962000011',
    });
    const sess = await loginByPhone(t.execPhone, t.execPassword);
    currentCookieHeader = sess.cookieHeader;
    await claimTicketAction({ ticketId: t.ticketId });
    const r = await resolveTicketAction({ ticketId: t.ticketId });
    expect(r.ok).toBe(true);
    const rows = await db
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, t.ticketId));
    expect(rows).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Customer reply route → staff notify
// -----------------------------------------------------------------------------

function buildReplyRequest(
  ticketId: string,
  body: unknown,
): { req: Request; ctx: { params: Promise<{ id: string }> } } {
  return {
    req: new Request(
      `https://visits.beakn.in/api/customer/support-tickets/${ticketId}/reply`,
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

describe('POST /api/customer/support-tickets/[id]/reply', () => {
  it('inserts a customer message and notifies staff', async () => {
    const t = await seedOpenTicket({
      captain: '+919963000001',
      exec: '+919963000002',
    });
    const { req, ctx } = buildReplyRequest(t.ticketId, {
      trackingToken: t.trackingToken,
      body: 'It still is not fixed.',
      turnstileToken: 'OK_TOKEN',
    });
    const res = await replyPOST(req, ctx);
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, t.ticketId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.authorKind).toBe('customer');
    expect(rows[0]!.authorUserId).toBeNull();
    expect(rows[0]!.body).toBe('It still is not fixed.');

    const replyCall = dispatchMock.mock.calls.find(
      (c) => c[0] === 'customer.support_ticket_reply',
    );
    expect(replyCall).toBeDefined();
    const dctx = replyCall![1] as Record<string, unknown>;
    expect(dctx.execUserId).toBe(t.execId);
    expect(dctx.cityCaptainUserId).toBe(t.captainId);
  });

  it('rejects a reply on a resolved ticket (409) — must reopen first', async () => {
    const t = await seedOpenTicket(
      { captain: '+919963000010', exec: '+919963000011' },
      'resolved',
    );
    const { req, ctx } = buildReplyRequest(t.ticketId, {
      trackingToken: t.trackingToken,
      body: 'late reply',
      turnstileToken: 'OK_TOKEN',
    });
    const res = await replyPOST(req, ctx);
    expect(res.status).toBe(409);
    const rows = await db
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, t.ticketId));
    expect(rows).toHaveLength(0);
  });

  it('rejects a mismatched tracking token (404)', async () => {
    const t = await seedOpenTicket({
      captain: '+919963000020',
      exec: '+919963000021',
    });
    const { req, ctx } = buildReplyRequest(t.ticketId, {
      trackingToken: 'wrong_token_123',
      body: 'nope',
      turnstileToken: 'OK_TOKEN',
    });
    const res = await replyPOST(req, ctx);
    expect(res.status).toBe(404);
  });
});

// -----------------------------------------------------------------------------
// Thread ordering + scoped load
// -----------------------------------------------------------------------------

describe('ticket thread', () => {
  it('loadTicketMessages returns messages oldest-first', async () => {
    const t = await seedOpenTicket({
      captain: '+919964000001',
      exec: '+919964000002',
    });
    const sess = await loginByPhone(t.execPhone, t.execPassword);
    currentCookieHeader = sess.cookieHeader;

    await replyToTicketAction({ ticketId: t.ticketId, body: 'first' });
    await replyToTicketAction({ ticketId: t.ticketId, body: 'second' });
    await replyToTicketAction({ ticketId: t.ticketId, body: 'third' });

    const messages = await loadTicketMessages(t.ticketId);
    expect(messages.map((m) => m.body)).toEqual(['first', 'second', 'third']);

    // Scoped thread action returns the same ordered set for the owner.
    const via = await loadTicketThreadAction({ ticketId: t.ticketId });
    expect(via.ok).toBe(true);
    if (via.ok) {
      expect(via.data!.messages.map((m) => m.body)).toEqual([
        'first',
        'second',
        'third',
      ]);
    }
  });
});
