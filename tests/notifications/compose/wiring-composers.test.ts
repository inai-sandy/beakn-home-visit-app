import { describe, expect, it } from 'vitest';

import { IN_APP_COMPOSERS } from '@/lib/notifications/compose';

// =============================================================================
// Notification-wiring fix: composer registration regression tests
// =============================================================================
//
// Pre-fix, `request.installation_scheduled`, `webhook.cartplus.order_received`
// and `request.approval_overdue` all had ENABLED notification_rules rows (some
// seeded well before this PR, some added by migration 0080) but no entry in
// IN_APP_COMPOSERS. `lib/notifications/channels/in-app.ts` looks the composer
// up by `IN_APP_COMPOSERS[eventType]` and returns
// `{ status: 'failed', error: 'no_in_app_composer_for_<eventType>' }` when it's
// undefined — so `IN_APP_COMPOSERS['request.installation_scheduled']` etc. was
// `undefined` and `composer(ctx)` would have thrown a TypeError
// ("composer is not a function") had the lookup even been attempted directly.
//
// These are pure unit tests (no DB) — fast confirmation that the registry
// entries exist and produce well-shaped bodies BEFORE we pay for the slower
// engine-level DB tests that exercise the full dispatch path.
// =============================================================================

describe('IN_APP_COMPOSERS wiring', () => {
  it('registers a composer for request.installation_scheduled that returns a well-shaped body', () => {
    const composer = IN_APP_COMPOSERS['request.installation_scheduled'];
    // Pre-fix: this lookup returned `undefined` (no key in the map at all).
    expect(composer).toBeTypeOf('function');

    const body = composer({
      requestId: '019e0000-0000-0000-0000-00000000ins1',
      customerName: 'Meera Nair',
      cityName: 'Chennai',
    });

    expect(body.title).toEqual(expect.any(String));
    expect(body.title.length).toBeGreaterThan(0);
    expect(body.body).toEqual(expect.any(String));
    expect(body.body.length).toBeGreaterThan(0);
    expect(body.title).toContain('Meera Nair');
    expect(body.linkUrl).toBe('/requests/019e0000-0000-0000-0000-00000000ins1');
  });

  it('registers a composer for webhook.cartplus.order_received that returns a well-shaped body', () => {
    const composer = IN_APP_COMPOSERS['webhook.cartplus.order_received'];
    // Pre-fix: this lookup returned `undefined`.
    expect(composer).toBeTypeOf('function');

    const body = composer({
      requestId: '019e0000-0000-0000-0000-00000000cp1',
      customerName: 'Asha Kumar',
      orderNumber: 'CP-1001',
      totalAmountInr: 1250.5,
    });

    expect(body.title).toEqual(expect.any(String));
    expect(body.title.length).toBeGreaterThan(0);
    expect(body.body).toEqual(expect.any(String));
    expect(body.body.length).toBeGreaterThan(0);
    expect(body.title).toContain('Asha Kumar');
    expect(body.linkUrl).toBe('/requests/019e0000-0000-0000-0000-00000000cp1');
  });

  it('registers a composer for request.approval_overdue that returns a well-shaped body', () => {
    const composer = IN_APP_COMPOSERS['request.approval_overdue'];
    // Pre-fix: this lookup returned `undefined`.
    expect(composer).toBeTypeOf('function');

    const body = composer({
      requestId: '019e0000-0000-0000-0000-00000000ovr',
      customerName: 'Rahul Verma',
      cityName: 'Pune',
      hoursStuck: 30,
    });

    expect(body.title).toEqual(expect.any(String));
    expect(body.title.length).toBeGreaterThan(0);
    expect(body.body).toEqual(expect.any(String));
    expect(body.body.length).toBeGreaterThan(0);
    expect(body.title).toContain('Rahul Verma');
    expect(body.linkUrl).toBe('/requests/019e0000-0000-0000-0000-00000000ovr');
  });
});
