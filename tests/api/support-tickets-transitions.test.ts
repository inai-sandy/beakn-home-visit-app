import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { supportTickets, visitRequests } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import {
  claimTicketAction,
  resolveTicketAction,
} from '@/lib/support-tickets/actions';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-255 (HVA-232 Phase 2): claim + resolve action tests
// =============================================================================

async function seedOpenTicket(): Promise<{
  ticketId: string;
  execId: string;
  execPhone: string;
  execPassword: string;
}> {
  const captain = await seedCaptain({ phone: '+919950000001' });
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: '+919950000002',
    fullName: 'Exec Tx',
    password: 'TxTest#1',
  });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'ORDER_CONFIRMED',
  });
  const [t] = await db
    .insert(supportTickets)
    .values({
      requestId: req.id,
      category: 'complaint',
      subject: 'Wrong colour',
      description: 'The blinds are blue, we ordered grey.',
      status: 'open',
      customerNameSnapshot: 'Test Customer',
      customerPhoneSnapshot: '+919999999999',
    })
    .returning({ id: supportTickets.id });
  return {
    ticketId: t!.id,
    execId: exec.id,
    execPhone: exec.phone,
    execPassword: exec.password,
  };
}

describe('claimTicketAction', () => {
  it('flips status open → in_progress + sets claimed fields', async () => {
    const t = await seedOpenTicket();
    const sess = await loginByPhone(t.execPhone, t.execPassword);
    currentCookieHeader = sess.cookieHeader;

    const r = await claimTicketAction({ ticketId: t.ticketId });
    expect(r.ok).toBe(true);

    const [updated] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, t.ticketId));
    expect(updated!.status).toBe('in_progress');
    expect(updated!.claimedAt).not.toBeNull();
    expect(updated!.claimedByUserId).toBe(t.execId);
  });

  it('rejects when ticket is not open', async () => {
    const t = await seedOpenTicket();
    // Pre-resolve the ticket
    await db
      .update(supportTickets)
      .set({ status: 'resolved', resolvedAt: new Date() })
      .where(eq(supportTickets.id, t.ticketId));

    const sess = await loginByPhone(t.execPhone, t.execPassword);
    currentCookieHeader = sess.cookieHeader;
    const r = await claimTicketAction({ ticketId: t.ticketId });
    expect(r.ok).toBe(false);
  });
});

describe('resolveTicketAction', () => {
  it('flips status in_progress → resolved', async () => {
    const t = await seedOpenTicket();
    const sess = await loginByPhone(t.execPhone, t.execPassword);
    currentCookieHeader = sess.cookieHeader;
    // Claim first
    await claimTicketAction({ ticketId: t.ticketId });
    // Then resolve
    const r = await resolveTicketAction({ ticketId: t.ticketId });
    expect(r.ok).toBe(true);

    const [updated] = await db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, t.ticketId));
    expect(updated!.status).toBe('resolved');
    expect(updated!.resolvedAt).not.toBeNull();
    expect(updated!.resolvedByUserId).toBe(t.execId);
  });

  it('rejects from open when caller is exec (must claim first)', async () => {
    const t = await seedOpenTicket();
    const sess = await loginByPhone(t.execPhone, t.execPassword);
    currentCookieHeader = sess.cookieHeader;
    const r = await resolveTicketAction({ ticketId: t.ticketId });
    expect(r.ok).toBe(false);
  });
});

// =============================================================================
// HVA-257: ownership scope — the action layer must enforce visibility,
// not just the queue's read-side scoping.
// =============================================================================

describe('HVA-257 ownership scope', () => {
  it('an unrelated exec cannot claim a ticket outside their assignment (IDOR)', async () => {
    const t = await seedOpenTicket();
    // A second exec on a DIFFERENT captain's team, not assigned to the request.
    const otherCaptain = await seedCaptain({ phone: '+919950000010' });
    const outsider = await seedExecutive(otherCaptain.id, {
      phone: '+919950000011',
      fullName: 'Outsider Exec',
      password: 'Outside#1',
    });
    const sess = await loginByPhone(outsider.phone, outsider.password);
    currentCookieHeader = sess.cookieHeader;

    const r = await claimTicketAction({ ticketId: t.ticketId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Ticket not found');

    // Ticket untouched
    const [after] = await db
      .select({ status: supportTickets.status })
      .from(supportTickets)
      .where(eq(supportTickets.id, t.ticketId));
    expect(after!.status).toBe('open');
  });

  it("a captain CAN claim a ticket on their team exec's request", async () => {
    const captain = await seedCaptain({
      phone: '+919950000020',
      password: 'CapScope#1',
    });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, { phone: '+919950000021' });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ORDER_CONFIRMED',
    });
    const [t] = await db
      .insert(supportTickets)
      .values({
        requestId: req.id,
        category: 'warranty',
        subject: 'Team scope claim',
        description: 'X',
        status: 'open',
        customerNameSnapshot: 'X',
        customerPhoneSnapshot: '+919999999990',
      })
      .returning({ id: supportTickets.id });

    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const r = await claimTicketAction({ ticketId: t!.id });
    expect(r.ok).toBe(true);
  });

  it('race: claim returns ok:false when the ticket was claimed between read and write', async () => {
    // We can't interleave two real transactions in a unit test, but the
    // conditional-UPDATE guard is exercised the same way: the second
    // caller's UPDATE matches 0 rows because status is no longer open.
    // The before-read also catches it; either path must yield ok:false
    // and must NOT overwrite the first claimer.
    const t = await seedOpenTicket();
    const sess = await loginByPhone(t.execPhone, t.execPassword);
    currentCookieHeader = sess.cookieHeader;

    const first = await claimTicketAction({ ticketId: t.ticketId });
    expect(first.ok).toBe(true);

    const second = await claimTicketAction({ ticketId: t.ticketId });
    expect(second.ok).toBe(false);

    const [after] = await db
      .select({ claimedByUserId: supportTickets.claimedByUserId })
      .from(supportTickets)
      .where(eq(supportTickets.id, t.ticketId));
    expect(after!.claimedByUserId).toBe(t.execId);
  });
});

// =============================================================================
// HVA-257: composer must not throw for admin-created category codes
// =============================================================================

describe('HVA-257 composer category fallback', () => {
  it('unknown category code composes a humanized title instead of throwing', async () => {
    const { composeSupportTicketCreatedInApp } = await import(
      '@/lib/notifications/compose/support-ticket-events'
    );
    const body = composeSupportTicketCreatedInApp({
      ticketId: 'x',
      requestId: 'r',
      customerName: 'Asha',
      category: 'partial_refund',
      subject: 'Half the order arrived',
    });
    expect(body.title).toBe('New partial refund from Asha');
  });

  it('seeded codes still use their curated labels', async () => {
    const { composeSupportTicketCreatedInApp } = await import(
      '@/lib/notifications/compose/support-ticket-events'
    );
    const body = composeSupportTicketCreatedInApp({
      ticketId: 'x',
      requestId: 'r',
      customerName: 'Asha',
      category: 'warranty',
      subject: 'Motor stopped working',
    });
    expect(body.title).toBe('New warranty claim from Asha');
  });
});

// Reference imports the linter would otherwise drop.
void visitRequests;
