import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { inAppNotifications, notificationRules, users } from '@/db/schema';
import { IN_APP_COMPOSERS } from '@/lib/notifications/compose';
import { dispatchNotification } from '@/lib/notifications/engine';

// =============================================================================
// HVA-329: a customer-initiated cancellation reaches support
// =============================================================================
//
// HVA-326 gave `request.cancelled_in_cartplus` a `support_team_all` rule on
// the reasoning that support hold the dispatch queue and are exactly who needs
// to know when goods may already be on their way. Its own migration said that
// out loud about the OTHER door — the /track "Cancel request" button, which
// writes `request.cancelled_by_customer` — and scoped the fix to CartPlus, so
// the gap it described stayed open.
//
// Verified live on 2026-08-06: cancelling a ZZTEST request from the tracking
// page reached the assigned exec, the owning captain and both super_admins,
// and zero support users, while that order's items sat in the support queue.
//
// NOTE ON WHAT IS TESTED WHERE. `tests/setup/per-file.ts` TRUNCATEs every
// table before each file, so migration-seeded rows are gone by the time a test
// runs — asserting "migration 0090 inserted the rule" is not possible in this
// harness (the same reason HVA-327's guard test parses source instead of
// querying). The rule is seeded here explicitly; the migration itself is
// verified against production after deploy.
// =============================================================================

const EVENT = 'request.cancelled_by_customer';

const BASE = {
  requestId: '019e0000-0000-0000-0000-00000cancust',
  customerName: 'Meera Rao',
  cityName: 'Bangalore',
  recipientRole: 'support_team_all',
};

async function seedSupportUser(name: string): Promise<string> {
  const phone = `+91993${Math.floor(Math.random() * 9000000 + 1000000)}`;
  const [u] = await db
    .insert(users)
    .values({
      role: 'support',
      fullName: name,
      phone,
      phoneVerified: true,
      isActive: true,
      mustChangePassword: false,
    })
    .returning({ id: users.id });
  return u.id;
}

describe('HVA-329: support receives the customer cancellation', () => {
  it('delivers an in-app notification to every active support user', async () => {
    const supportId = await seedSupportUser('Support Cancel Reach');
    await db.insert(notificationRules).values({
      eventType: EVENT,
      channel: 'in_app',
      recipientRole: 'support_team_all',
      enabled: true,
    });

    await dispatchNotification(EVENT, {
      requestId: BASE.requestId,
      customerName: BASE.customerName,
      cityName: BASE.cityName,
      stageName: 'Order Confirmed',
      dispatchedItemCount: 2,
    });

    const rows = await db
      .select({ title: inAppNotifications.title, body: inAppNotifications.body })
      .from(inAppNotifications)
      .where(eq(inAppNotifications.userId, supportId));

    expect(rows).toHaveLength(1);
    // The wording support acts on — not the captain's "customer cancelled
    // their visit", which is what they got before the composer branch existed.
    expect(rows[0].body).toContain('Stop any pending dispatch');
    expect(rows[0].body).toContain('2 items have already been dispatched');
  });
});

describe('HVA-329: the message support gets', () => {
  it('leads with stopping the dispatch, and names the stage', () => {
    const composed = IN_APP_COMPOSERS[EVENT]({
      ...BASE,
      stageName: 'Installation Scheduled',
      dispatchedItemCount: 0,
    });

    // Without the support branch this fell through to the CAPTAIN composer,
    // whose body is "Customer cancelled their visit in Bangalore." — true,
    // and useless to the person holding the goods.
    expect(composed.body).toContain('Stop any pending dispatch');
    expect(composed.body).toContain('while at Installation Scheduled');
  });

  it('warns about stock already out, with the count', () => {
    const composed = IN_APP_COMPOSERS[EVENT]({
      ...BASE,
      stageName: 'Order Confirmed',
      dispatchedItemCount: 3,
    });
    expect(composed.body).toContain('3 items have already been dispatched');
    expect(composed.body).toContain('recovered manually');
  });

  it('stays quiet about recovery when nothing has shipped', () => {
    const composed = IN_APP_COMPOSERS[EVENT]({
      ...BASE,
      stageName: 'Quotation Given',
      dispatchedItemCount: 0,
    });
    expect(composed.body).not.toContain('recovered manually');
  });

  it('leaves the other audiences their own wording', () => {
    const captain = IN_APP_COMPOSERS[EVENT]({
      ...BASE,
      recipientRole: 'captain_owning_city',
    });
    const admin = IN_APP_COMPOSERS[EVENT]({
      ...BASE,
      recipientRole: 'super_admin',
    });
    // The support branch must not have swallowed the existing audiences.
    expect(captain.body).not.toContain('Stop any pending dispatch');
    expect(admin.body).not.toContain('Stop any pending dispatch');
  });
});
