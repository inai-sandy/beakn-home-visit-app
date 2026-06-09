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
} from '@/app/tickets/_actions/transitions';

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

// Reference imports the linter would otherwise drop.
void visitRequests;
