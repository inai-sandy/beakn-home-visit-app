import { describe, expect, it } from 'vitest';

import {
  composeRequestApprovedInApp,
  composeRequestRejectedInApp,
  type RequestApprovedContext,
  type RequestRejectedContext,
} from '@/lib/notifications/compose/request-approved';

// =============================================================================
// HVA-137: composer contracts for request.approved + request.rejected
// =============================================================================

function approvedCtx(): RequestApprovedContext {
  return {
    requestId: '019e34b6-990e-7721-af09-28647753bb14',
    customerName: 'Sandeep',
    cityName: 'Hyderabad',
    captainUserId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    captainName: 'Arjun',
    execUserId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    execName: 'Veera',
    note: 'Great work — customer is happy.',
  };
}

function rejectedCtx(): RequestRejectedContext {
  return {
    requestId: '019e34b6-990e-7721-af09-28647753bb14',
    customerName: 'Sandeep',
    cityName: 'Hyderabad',
    captainUserId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    captainName: 'Arjun',
    execUserId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    execName: 'Veera',
    reason:
      'The mounting bracket placement near the puja shelf needs adjustment.',
  };
}

describe('composeRequestApprovedInApp', () => {
  it('title names the captain + customer', () => {
    const b = composeRequestApprovedInApp(approvedCtx());
    expect(b.title).toBe("Arjun approved Sandeep's order");
  });

  it('body includes city + captain note when present', () => {
    const b = composeRequestApprovedInApp(approvedCtx());
    expect(b.body).toContain('Hyderabad');
    expect(b.body).toMatch(/Note: Great work/);
  });

  it('body omits the Note: suffix when note is null', () => {
    const b = composeRequestApprovedInApp({ ...approvedCtx(), note: null });
    expect(b.body).not.toMatch(/Note:/);
  });

  it('linkUrl points at the request detail page', () => {
    const b = composeRequestApprovedInApp(approvedCtx());
    expect(b.linkUrl).toBe(
      '/requests/019e34b6-990e-7721-af09-28647753bb14',
    );
  });
});

describe('composeRequestRejectedInApp', () => {
  it('title names the captain + customer', () => {
    const b = composeRequestRejectedInApp(rejectedCtx());
    expect(b.title).toBe("Arjun requested changes on Sandeep's order");
  });

  it('body includes the captain reason verbatim', () => {
    const b = composeRequestRejectedInApp(rejectedCtx());
    expect(b.body).toContain('Hyderabad');
    expect(b.body).toContain('Reason: The mounting bracket placement');
  });

  it('linkUrl points at the request detail page', () => {
    const b = composeRequestRejectedInApp(rejectedCtx());
    expect(b.linkUrl).toBe(
      '/requests/019e34b6-990e-7721-af09-28647753bb14',
    );
  });
});
