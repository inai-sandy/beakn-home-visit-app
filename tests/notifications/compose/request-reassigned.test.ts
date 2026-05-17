import { describe, expect, it } from 'vitest';

import {
  composeRequestReassignedEmailCaptain,
  composeRequestReassignedInAppAssigned,
  composeRequestReassignedInAppRemoved,
  type RequestReassignedContext,
} from '@/lib/notifications/compose/request-reassigned';

// =============================================================================
// HVA-140: composer contracts for request.reassigned
// =============================================================================

function baseCtx(): RequestReassignedContext {
  return {
    requestId: '019e34b6-990e-7721-af09-28647753bb14',
    customerName: 'Sandeep',
    cityName: 'Hyderabad',
    oldExecUserId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    oldExecName: 'Veera',
    newExecUserId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    newExecName: 'Vishnu',
    captainUserId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    captainName: 'Arjun',
    reason:
      'Veera is going on leave tomorrow — transferring continuity of the installation work.',
  };
}

describe('composeRequestReassignedInAppRemoved', () => {
  it('title names the customer; body names the captain + new exec + reason', () => {
    const body = composeRequestReassignedInAppRemoved(baseCtx());
    expect(body.title).toBe("Removed from Sandeep's visit");
    expect(body.body).toContain('Arjun');
    expect(body.body).toContain('Vishnu');
    expect(body.body).toContain('Hyderabad');
    expect(body.body).toMatch(/Reason: Veera is going on leave/);
  });

  it('linkUrl is empty for the removed exec (no longer has access)', () => {
    const body = composeRequestReassignedInAppRemoved(baseCtx());
    expect(body.linkUrl).toBe('');
  });
});

describe('composeRequestReassignedInAppAssigned', () => {
  it('title names the customer; body names the old exec + reason', () => {
    const body = composeRequestReassignedInAppAssigned(baseCtx());
    expect(body.title).toBe("Assigned to Sandeep's visit");
    expect(body.body).toContain('Veera');
    expect(body.body).toContain('Hyderabad');
    expect(body.body).toMatch(/Captain's note: Veera is going on leave/);
  });

  it('linkUrl points at the request detail page', () => {
    const body = composeRequestReassignedInAppAssigned(baseCtx());
    expect(body.linkUrl).toBe(
      '/requests/019e34b6-990e-7721-af09-28647753bb14',
    );
  });
});

describe('composeRequestReassignedEmailCaptain', () => {
  it('subject names both execs', () => {
    const body = composeRequestReassignedEmailCaptain(baseCtx());
    expect(body.subject).toBe(
      'Reassigned Sandeep from Veera to Vishnu',
    );
  });

  it('text body includes both exec names, city, and reason', () => {
    const body = composeRequestReassignedEmailCaptain(baseCtx());
    expect(body.bodyText).toContain('Previous exec: Veera');
    expect(body.bodyText).toContain('New exec: Vishnu');
    expect(body.bodyText).toContain('Hyderabad');
    expect(body.bodyText).toContain('Reason: Veera is going on leave');
  });

  it('HTML body escapes user-supplied strings', () => {
    const html = composeRequestReassignedEmailCaptain({
      ...baseCtx(),
      reason: '<script>alert("xss")</script>'.padEnd(60, ' '),
    });
    expect(html.bodyHtml).not.toContain('<script>alert');
    expect(html.bodyHtml).toContain('&lt;script&gt;');
  });
});
