import { describe, expect, it } from 'vitest';

import {
  composeRequestRolledBackInApp,
  type RequestRolledBackContext,
} from '@/lib/notifications/compose/request-rolled-back';

// =============================================================================
// HVA-141: composer contract for request.rolled_back
// =============================================================================
//
// Composers are pure functions; tests pin the body shape so future
// callers (e.g. an admin dashboard rendering a notification preview)
// can rely on what's there.
// =============================================================================

function baseCtx(): RequestRolledBackContext {
  return {
    requestId: '019e34b6-990e-7721-af09-28647753bb14',
    customerName: 'Sandeep',
    cityCaptainUserId: '019e32ec-fc3b-7bfb-9405-5060e0de4f2b',
    actorUserId: '019e32ee-5bf5-767c-8127-9508451018b8',
    actorName: 'Veera',
    fromStageId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    fromStageName: 'Visit Completed',
    toStageId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    toStageName: 'Visit Scheduled',
    reason: 'Customer was not home; retrying tomorrow.',
  };
}

describe('composeRequestRolledBackInApp', () => {
  it('renders title with actor + customer name', () => {
    const body = composeRequestRolledBackInApp(baseCtx());
    expect(body.title).toBe('Veera moved Sandeep back');
  });

  it('renders body with from/to stage names and the reason', () => {
    const body = composeRequestRolledBackInApp(baseCtx());
    expect(body.body).toContain('Visit Completed');
    expect(body.body).toContain('Visit Scheduled');
    expect(body.body).toContain('Reason: Customer was not home');
  });

  it('substitutes "(no reason given)" when reason is null', () => {
    const body = composeRequestRolledBackInApp({
      ...baseCtx(),
      reason: null,
    });
    expect(body.body).toContain('(no reason given)');
    expect(body.body).not.toMatch(/Reason:\s/);
  });

  it('substitutes "(no reason given)" when reason is empty string', () => {
    const body = composeRequestRolledBackInApp({
      ...baseCtx(),
      reason: '',
    });
    expect(body.body).toContain('(no reason given)');
  });

  it('substitutes "(no reason given)" when reason is whitespace only', () => {
    const body = composeRequestRolledBackInApp({
      ...baseCtx(),
      reason: '   \n\t  ',
    });
    expect(body.body).toContain('(no reason given)');
  });

  it('linkUrl points at the request detail page', () => {
    const body = composeRequestRolledBackInApp(baseCtx());
    expect(body.linkUrl).toBe(
      '/requests/019e34b6-990e-7721-af09-28647753bb14',
    );
  });
});
