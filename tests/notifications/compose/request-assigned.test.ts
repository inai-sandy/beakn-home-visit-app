import { describe, expect, it } from 'vitest';

import {
  composeRequestAssignedEmail,
  composeRequestAssignedInApp,
  type RequestAssignedContext,
} from '@/lib/notifications/compose/request-assigned';

const baseCtx: RequestAssignedContext = {
  requestId: '019e0000-0000-0000-0000-000000000001',
  customerName: 'Aarav Sharma',
  cityName: 'Bangalore',
  execUserId: '019e0000-0000-0000-0000-000000000002',
  execName: 'Veera Exec',
  captainUserId: '019e0000-0000-0000-0000-000000000003',
  captainName: 'Arjun Captain',
};

describe('composeRequestAssignedInApp', () => {
  it('produces expected title + body + linkUrl', () => {
    const body = composeRequestAssignedInApp({
      ...baseCtx,
      note: 'Prefers evening visit',
    });
    expect(body.title).toBe('New request assigned: Aarav Sharma');
    expect(body.body).toBe(
      'Arjun Captain assigned you a visit in Bangalore. Note: Prefers evening visit',
    );
    expect(body.linkUrl).toBe('/requests/019e0000-0000-0000-0000-000000000001');
  });

  it('omits Note: line when note is undefined', () => {
    const body = composeRequestAssignedInApp(baseCtx);
    expect(body.body).not.toMatch(/Note:/u);
    expect(body.body).toBe('Arjun Captain assigned you a visit in Bangalore.');
  });

  it('omits Note: line when note is empty string', () => {
    const body = composeRequestAssignedInApp({ ...baseCtx, note: '   ' });
    expect(body.body).not.toMatch(/Note:/u);
  });
});

describe('composeRequestAssignedEmail', () => {
  it('produces expected subject + text + html with note', () => {
    const body = composeRequestAssignedEmail({
      ...baseCtx,
      note: 'Bring power bank',
    });
    expect(body.subject).toBe('Assigned: Aarav Sharma — Bangalore');
    expect(body.bodyText).toContain(
      'You assigned Veera Exec to handle Aarav Sharma',
    );
    expect(body.bodyText).toContain('Your note: Bring power bank');
    expect(body.bodyText).toContain('/requests/019e0000-0000-0000-0000-000000000001');
    expect(body.bodyHtml).toContain('Bring power bank');
    expect(body.bodyHtml).toContain('Veera Exec');
  });

  it('omits Your note: section when note is undefined', () => {
    const body = composeRequestAssignedEmail(baseCtx);
    expect(body.bodyText).not.toMatch(/Your note:/u);
    expect(body.bodyHtml).not.toMatch(/Your note:/u);
  });

  it('HTML-escapes user-provided strings to prevent injection', () => {
    const body = composeRequestAssignedEmail({
      ...baseCtx,
      customerName: '<script>alert(1)</script>',
      note: '<img src=x onerror=y>',
    });
    expect(body.bodyHtml).not.toContain('<script>');
    expect(body.bodyHtml).toContain('&lt;script&gt;');
    expect(body.bodyHtml).toContain('&lt;img');
  });
});
