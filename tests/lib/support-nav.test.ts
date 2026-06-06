import { describe, expect, it } from 'vitest';

import { activeSupportNav, SUPPORT_NAV } from '@/lib/support/nav';

describe('SUPPORT_NAV', () => {
  it('has exactly 3 entries: Queue, Orders, Activity', () => {
    expect(SUPPORT_NAV.map((i) => i.label)).toEqual([
      'Queue',
      'Orders',
      'Activity',
    ]);
  });

  it('all hrefs start with /support', () => {
    for (const item of SUPPORT_NAV) {
      expect(item.href.startsWith('/support')).toBe(true);
    }
  });

  it('Queue href is exactly /support (root of the portal)', () => {
    expect(SUPPORT_NAV[0]?.href).toBe('/support');
  });
});

describe('activeSupportNav', () => {
  it('matches exact /support to Queue', () => {
    expect(activeSupportNav('/support')?.label).toBe('Queue');
  });

  it('does NOT match a sub-route of /support to Queue', () => {
    // Without this rule, /support/orders would also match Queue
    // because /support is a prefix of /support/orders.
    expect(activeSupportNav('/support/orders')?.label).toBe('Orders');
  });

  it('matches /support/orders prefix to Orders', () => {
    expect(activeSupportNav('/support/orders/abc')?.label).toBe('Orders');
  });

  it('matches /support/activity', () => {
    expect(activeSupportNav('/support/activity')?.label).toBe('Activity');
  });

  it('returns null on unknown path', () => {
    expect(activeSupportNav('/captain/dashboard')).toBe(null);
    expect(activeSupportNav('/random')).toBe(null);
  });
});
