import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { cities, users } from '@/db/schema';

// Mock lib/email BEFORE importing lib/notifications (which the handler
// module imports sendEmail from). vi.mock is hoisted by vitest.
const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email', () => ({
  sendEmail: sendEmailMock,
}));

import { emit } from '@/lib/events';
// Side-effect import: registers handleRequestSubmitted as a subscriber.
import '@/lib/notifications';

import { getOrCreateCity, seedSuperAdmin } from '../helpers/db';

// =============================================================================
// HVA-109 Area 3: lib/notifications/email-handlers/captain-new-request.ts
// =============================================================================
//
// Schema reality verified:
//   - cities.captain_routing_email (varchar(255) nullable) is the routing
//     target column. NOT cities.captain_user_id → users.email.
//   - cities.name === 'Other' short-circuits to the super_admin BCC path
//     regardless of routing_email value.
//   - Active super_admin recipients are queried as:
//     users.role='super_admin' AND users.is_active=true, then users.email
//     filtered to non-null/non-blank.
//
// Mock strategy:
//   - vi.mock('@/lib/email', ...) replaces sendEmail with a captured mock.
//     We never hit Hostinger SMTP from tests; assertions are on sendEmail
//     args (recipient, bcc, subject, templateName).
//
// Async dispatch:
//   - emit() schedules the handler via setImmediate; the handler is async.
//     Tests use vi.waitFor() to poll the mock until it's been called,
//     instead of fragile manual setImmediate ticks.
// =============================================================================

const BASE_PAYLOAD = {
  requestId: '00000000-0000-7000-8000-100000000000',
  trackingToken: 'tok_test_aaaaaaaaaaaaaaaaaa',
  customerName: 'HVA-109 Customer',
  customerPhone: '+919876500001',
  customerEmail: 'cust@example.com',
  address: '42 Verification Lane, Indiranagar',
  customerState: 'Karnataka',
  bhk: '3BHK',
  interest: ['Automation'],
  submittedAt: '2026-05-16T10:00:00.000Z',
  requestIdHeader: 'rid_test_xyz',
};

async function fireAndAwait(payload: Parameters<typeof emit>[1]): Promise<void> {
  emit('request.submitted', payload);
  // Poll until the handler invokes sendEmail. The handler is async + sits
  // behind setImmediate + Promise.allSettled; vi.waitFor handles all that.
  await vi.waitFor(() => {
    expect(sendEmailMock).toHaveBeenCalled();
  });
}

beforeEach(() => {
  sendEmailMock.mockReset();
  // Default: every send succeeds. Per-test can override with mockReturnValueOnce.
  sendEmailMock.mockResolvedValue({
    ok: true,
    messageId: '<test-message-id@example.test>',
  });
});

describe('captain-new-request handler: routing flavor=captain', () => {
  it('city with captain_routing_email populated → sends to that email, no BCC, no [UNROUTED] prefix', async () => {
    const blr = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainRoutingEmail: 'captain.hyd@example.com' })
      .where(eq(cities.id, blr.id));

    await fireAndAwait({
      ...BASE_PAYLOAD,
      cityId: blr.id,
      cityName: 'Bangalore',
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const args = sendEmailMock.mock.calls[0][0];
    expect(args.to).toBe('captain.hyd@example.com');
    expect(args.bcc).toBeUndefined();
    expect(args.subject).toContain('New Home Visit Request');
    expect(args.subject).toContain('HVA-109 Customer');
    expect(args.subject).toContain('Bangalore');
    expect(args.subject).not.toContain('[UNROUTED');
    expect(args.subject).not.toContain('Other City');
    expect(args.templateName).toBe('captain-new-request');
  });
});

describe('captain-new-request handler: routing flavor=other', () => {
  it("city = 'Other' → routes to SMTP_FROM with active super_admin BCCs and (Other City: ...) subject", async () => {
    const other = await getOrCreateCity('Other');
    const sa1 = await seedSuperAdmin({
      phone: '+918888810001',
      email: 'admin1@example.com',
    });
    const sa2 = await seedSuperAdmin({
      phone: '+918888810002',
      email: 'admin2@example.com',
    });
    void sa1;
    void sa2;

    await fireAndAwait({
      ...BASE_PAYLOAD,
      cityId: other.id,
      cityName: 'Other',
    });

    const args = sendEmailMock.mock.calls[0][0];
    expect(args.to).toBe('visits@beakn.in');
    expect(args.bcc).toEqual(
      expect.arrayContaining(['admin1@example.com', 'admin2@example.com']),
    );
    expect(args.bcc.length).toBe(2);
    expect(args.subject).toContain('(Other City: Other)');
    expect(args.subject).not.toContain('[UNROUTED');
  });

  it("'Other' route still runs when zero active super_admins exist (BCC empty)", async () => {
    // No super_admins seeded — BCC empty path.
    const other = await getOrCreateCity('Other');

    await fireAndAwait({
      ...BASE_PAYLOAD,
      cityId: other.id,
      cityName: 'Other',
    });

    const args = sendEmailMock.mock.calls[0][0];
    expect(args.to).toBe('visits@beakn.in');
    // Handler passes bcc:undefined when the list is empty (sendEmail
    // contract: bcc?: string[]).
    expect(args.bcc).toBeUndefined();
  });
});

describe('captain-new-request handler: routing flavor=unrouted', () => {
  it('real city with NULL captain_routing_email → [UNROUTED] subject prefix + super_admin BCC', async () => {
    const hyd = await getOrCreateCity('Hyderabad');
    // Leave captain_routing_email NULL (cities seed default).
    const sa = await seedSuperAdmin({
      phone: '+918888820001',
      email: 'admin-unrouted@example.com',
    });
    void sa;

    await fireAndAwait({
      ...BASE_PAYLOAD,
      cityId: hyd.id,
      cityName: 'Hyderabad',
    });

    const args = sendEmailMock.mock.calls[0][0];
    expect(args.to).toBe('visits@beakn.in');
    expect(args.bcc).toEqual(['admin-unrouted@example.com']);
    expect(args.subject).toMatch(/^\[UNROUTED — Hyderabad\] /);
  });
});

describe('captain-new-request handler: SMTP failure non-propagation', () => {
  it('sendEmail returning {ok:false} does NOT throw or crash the dispatcher', async () => {
    sendEmailMock.mockReset();
    sendEmailMock.mockResolvedValue({
      ok: false,
      error: 'Invalid login: 535 5.7.8 simulated auth failure',
    });
    const blr = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainRoutingEmail: 'captain.test@example.com' })
      .where(eq(cities.id, blr.id));

    // Fire and await — the handler should still complete (no thrown promise
    // visible to the caller; events.ts catches per-handler errors).
    await fireAndAwait({
      ...BASE_PAYLOAD,
      cityId: blr.id,
      cityName: 'Bangalore',
    });

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    // The handler's internal `captain_route_send_failed` log line fires —
    // we can't easily intercept pino in-process, but the mock was called
    // (failure was reached + handled) and no uncaught rejection escaped.
  });
});

describe('captain-new-request handler: city resolution failure', () => {
  it('payload pointing at non-existent cityId → handler logs + skips, no email sent', async () => {
    sendEmailMock.mockClear();
    await emit('request.submitted', {
      ...BASE_PAYLOAD,
      cityId: '00000000-0000-7000-8000-000000000000',
      cityName: 'Ghost',
    });

    // Wait long enough for the handler to have run and bailed (it logs +
    // returns early without calling sendEmail).
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

// Keep users export referenced so the import survives if a future linter
// pass aggressively prunes "type-only" or unused imports.
void users;
