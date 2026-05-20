import { describe, expect, it } from 'vitest';

import {
  buildListUrl,
  computePageRange,
  parsePage,
  parsePageSize,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@/lib/pagination';

// =============================================================================
// HVA-153: pagination helpers
// =============================================================================

describe('parsePage', () => {
  it('returns 1 for missing / empty / non-numeric / negative', () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage('')).toBe(1);
    expect(parsePage('abc')).toBe(1);
    expect(parsePage('-3')).toBe(1);
    expect(parsePage('0')).toBe(1);
  });

  it('parses positive integers', () => {
    expect(parsePage('1')).toBe(1);
    expect(parsePage('5')).toBe(5);
    expect(parsePage('99999')).toBe(99999);
  });
});

describe('parsePageSize', () => {
  it('returns the default when missing', () => {
    expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });
  it('clamps over-large requests to MAX_PAGE_SIZE', () => {
    expect(parsePageSize('999')).toBe(MAX_PAGE_SIZE);
  });
  it('rejects zero / negative / non-numeric', () => {
    expect(parsePageSize('0')).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize('-5')).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize('not-a-number')).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe('computePageRange — boundary cases', () => {
  it('total=0 → page 1 / from=0 / to=0 / totalPages=1', () => {
    const r = computePageRange({ total: 0, page: 1 });
    expect(r).toEqual({
      page: 1,
      totalPages: 1,
      from: 0,
      to: 0,
      offset: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      total: 0,
    });
  });

  it('total < pageSize → single page', () => {
    const r = computePageRange({ total: 7, page: 1, pageSize: 20 });
    expect(r.totalPages).toBe(1);
    expect(r.from).toBe(1);
    expect(r.to).toBe(7);
    expect(r.offset).toBe(0);
  });

  it('exact page boundary — 40 rows / size 20 / page 2', () => {
    const r = computePageRange({ total: 40, page: 2, pageSize: 20 });
    expect(r.totalPages).toBe(2);
    expect(r.from).toBe(21);
    expect(r.to).toBe(40);
    expect(r.offset).toBe(20);
  });

  it('non-exact page — 137 rows / size 20 / page 7', () => {
    const r = computePageRange({ total: 137, page: 7, pageSize: 20 });
    expect(r.totalPages).toBe(7);
    expect(r.from).toBe(121);
    expect(r.to).toBe(137);
  });

  it('clamps page > totalPages down to last page', () => {
    const r = computePageRange({ total: 25, page: 99, pageSize: 20 });
    expect(r.page).toBe(2);
    expect(r.from).toBe(21);
    expect(r.to).toBe(25);
  });

  it('clamps page < 1 up to 1', () => {
    const r = computePageRange({ total: 25, page: -3, pageSize: 20 });
    expect(r.page).toBe(1);
    expect(r.from).toBe(1);
    expect(r.to).toBe(20);
  });
});

describe('buildListUrl', () => {
  it('appends a single filter and drops page', () => {
    const current = new URLSearchParams('q=alice&page=4');
    expect(buildListUrl('/leads', current, { type: 'Customer' })).toBe(
      '/leads?q=alice&type=Customer',
    );
  });

  it('replaces an existing param and drops page', () => {
    const current = new URLSearchParams('type=Customer&page=3');
    expect(buildListUrl('/leads', current, { type: 'Business' })).toBe(
      '/leads?type=Business',
    );
  });

  it('removes a param when override is null / empty', () => {
    const current = new URLSearchParams('q=alice&type=Customer&page=3');
    expect(buildListUrl('/leads', current, { type: null })).toBe(
      '/leads?q=alice',
    );
    expect(buildListUrl('/leads', current, { type: '' })).toBe('/leads?q=alice');
  });

  it('preserves all params when only `page` overrides', () => {
    const current = new URLSearchParams('q=alice&type=Customer&page=1');
    expect(buildListUrl('/leads', current, { page: 3 })).toBe(
      '/leads?q=alice&type=Customer&page=3',
    );
  });

  it('drops "?page=1" because page 1 is implicit', () => {
    const current = new URLSearchParams('q=alice&page=5');
    expect(buildListUrl('/leads', current, { page: 1 })).toBe('/leads?q=alice');
  });

  it('returns the bare pathname when no params remain', () => {
    const current = new URLSearchParams('type=Customer');
    expect(buildListUrl('/leads', current, { type: null })).toBe('/leads');
  });

  it('captain composite — bucket + city + exec + q + page', () => {
    const current = new URLSearchParams(
      'bucket=open&city=blr&exec=ravi&q=rakesh',
    );
    expect(buildListUrl('/captain/requests', current, { page: 2 })).toBe(
      '/captain/requests?bucket=open&city=blr&exec=ravi&q=rakesh&page=2',
    );
  });

  it('changing bucket drops page', () => {
    const current = new URLSearchParams(
      'bucket=open&city=blr&exec=ravi&q=rakesh&page=4',
    );
    expect(
      buildListUrl('/captain/requests', current, { bucket: 'assigned' }),
    ).toBe('/captain/requests?bucket=assigned&city=blr&exec=ravi&q=rakesh');
  });

  it('accepts a plain Record (server searchParams) as current', () => {
    expect(
      buildListUrl(
        '/leads',
        { q: 'alice', page: '4' },
        { type: 'Customer' },
      ),
    ).toBe('/leads?q=alice&type=Customer');
  });
});
