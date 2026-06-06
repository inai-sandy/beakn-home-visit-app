import { describe, expect, it } from 'vitest';

import { activeSupportNav, SUPPORT_NAV } from '@/lib/support/nav';

describe('SUPPORT_NAV', () => {
  it('HVA-245: has 4 entries — Pending, In-progress, Orders, Activity', () => {
    expect(SUPPORT_NAV.map((i) => i.label)).toEqual([
      'Pending',
      'In-progress',
      'Orders',
      'Activity',
    ]);
  });

  it('all hrefs start with /support', () => {
    for (const item of SUPPORT_NAV) {
      expect(item.href.startsWith('/support')).toBe(true);
    }
  });

  it('Pending href is exactly /support (root of the portal)', () => {
    expect(SUPPORT_NAV[0]?.href).toBe('/support');
  });
});

describe('activeSupportNav', () => {
  it('matches exact /support to Pending', () => {
    expect(activeSupportNav('/support')?.label).toBe('Pending');
  });

  it('does NOT match a sub-route of /support to Pending', () => {
    // Without this rule, /support/orders would also match Pending
    // because /support is a prefix of /support/orders.
    expect(activeSupportNav('/support/orders')?.label).toBe('Orders');
  });

  it('matches /support/in-progress', () => {
    expect(activeSupportNav('/support/in-progress')?.label).toBe('In-progress');
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
