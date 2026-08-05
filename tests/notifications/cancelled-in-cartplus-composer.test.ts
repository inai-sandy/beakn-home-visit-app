import { describe, expect, it } from 'vitest';

import { IN_APP_COMPOSERS } from '@/lib/notifications/compose';
import { composeRequestCancelledInCartplusInApp } from '@/lib/notifications/compose/request-cancelled-in-cartplus';

// =============================================================================
// HVA-326: the CartPlus cancellation message
// =============================================================================
//
// Pure unit tests. The two things this message has to get right are the two
// things a reader acts on:
//
//   * the STAGE it was cancelled at — "cancelled" at Quotation Given is
//     paperwork, "cancelled" at Installation Scheduled means someone's day
//     just freed up and a customer is expecting a van;
//   * whether stock is already out — that is the difference between closing
//     a record and driving somewhere to collect goods.
// =============================================================================

const BASE = {
  requestId: '019e0000-0000-0000-0000-0000000canc1',
  customerName: 'Sunil Kumar',
  cityName: 'Bangalore',
  stageName: 'Installation Scheduled',
  orderNumber: 'CP-20260729-UTI10K',
  dispatchedItemCount: 0,
};

describe('request.cancelled_in_cartplus composer', () => {
  it('is registered in IN_APP_COMPOSERS', () => {
    // push reuses IN_APP_COMPOSERS, so an unregistered event fails BOTH
    // channels — the exact shape of the bug HVA-311 was opened for.
    expect(IN_APP_COMPOSERS['request.cancelled_in_cartplus']).toBeTypeOf(
      'function',
    );
  });

  it('names the stage the request was cancelled at', () => {
    const body = composeRequestCancelledInCartplusInApp(BASE);
    expect(body.body).toContain('Installation Scheduled');
    expect(body.title).toContain('Sunil Kumar');
    expect(body.linkUrl).toBe(`/requests/${BASE.requestId}`);
  });

  it('says nothing about dispatch when nothing has been dispatched', () => {
    const body = composeRequestCancelledInCartplusInApp(BASE);
    expect(body.body).not.toMatch(/dispatched/i);
    expect(body.body).not.toMatch(/recovered/i);
  });

  it('warns about stock already dispatched, and counts it', () => {
    const body = composeRequestCancelledInCartplusInApp({
      ...BASE,
      dispatchedItemCount: 3,
    });
    expect(body.body).toContain('3 items have already been dispatched');
    expect(body.body).toMatch(/recovered manually/);
  });

  it('reads correctly for a single dispatched item', () => {
    const body = composeRequestCancelledInCartplusInApp({
      ...BASE,
      dispatchedItemCount: 1,
    });
    expect(body.body).toContain('1 item has already been dispatched');
  });

  it('gives support the instruction support can act on', () => {
    const support = composeRequestCancelledInCartplusInApp({
      ...BASE,
      recipientRole: 'support_team_all',
    });
    // Support hold the dispatch queue; the actionable verb has to be there.
    expect(support.body).toMatch(/stop any pending dispatch/i);

    const exec = composeRequestCancelledInCartplusInApp({
      ...BASE,
      recipientRole: 'exec_assigned',
    });
    expect(exec.body).not.toMatch(/stop any pending dispatch/i);
    expect(exec.body).toMatch(/cleared/i);
  });

  it('degrades gracefully when optional context is missing', () => {
    // The engine skips a delivery when a resolver key is absent, but the
    // composer itself must never produce an empty or "undefined" body.
    const body = composeRequestCancelledInCartplusInApp({
      requestId: BASE.requestId,
      customerName: 'Asha',
    });
    expect(body.title.length).toBeGreaterThan(0);
    expect(body.body.length).toBeGreaterThan(0);
    expect(body.title).not.toMatch(/undefined|null/);
    expect(body.body).not.toMatch(/undefined|null/);
  });
});
