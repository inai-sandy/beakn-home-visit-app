import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { cities } from '@/db/schema';
import { getCitiesForRequestForm } from '@/lib/cities-list';

// =============================================================================
// HVA-100: cities-list helper — shape + ordering + active filter
// =============================================================================
//
// The HVA-101 harness applies migration 0004 which seeds the 9 Phase 1
// cities (8 named + Other) with state values for the named rows.
// Asserts:
//   1. Helper returns every active row.
//   2. Each row carries id (uuid), name (string), state (string|null).
//   3. Order: alphabetical with "Other" pinned last.
//   4. is_active=false rows are excluded.
// =============================================================================

const EXPECTED_NAMES_ORDER = [
  'Ahmedabad',
  'Bangalore',
  'Chennai',
  'Hyderabad',
  'Mumbai',
  'Pune',
  'Vijayawada',
  'Vizag',
  'Other',
];

describe('getCitiesForRequestForm()', () => {
  it('returns all active seeded cities in alphabetical order with Other last', async () => {
    const rows = await getCitiesForRequestForm();
    const names = rows.map((r) => r.name);
    expect(names).toEqual(EXPECTED_NAMES_ORDER);
  });

  it('each row carries id, name, state with state nullable on Other', async () => {
    const rows = await getCitiesForRequestForm();
    for (const r of rows) {
      expect(typeof r.id).toBe('string');
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.name).toBe('string');
      expect(r.name.length).toBeGreaterThan(0);
      if (r.name === 'Other') {
        expect(r.state).toBeNull();
      } else {
        expect(typeof r.state).toBe('string');
        expect((r.state ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('excludes is_active=false rows', async () => {
    // Flip Pune to inactive; assert it disappears from the helper output.
    // afterEach in tests/setup/per-file.ts resets the cities row's mutable
    // columns — but is_active isn't in that reset list, so restore it
    // explicitly here.
    try {
      await db
        .update(cities)
        .set({ isActive: false })
        .where(eq(cities.name, 'Pune'));
      const rows = await getCitiesForRequestForm.bind(null)();
      // React's cache() dedups per-render; vitest workers don't have a
      // "render" boundary, so the call above is a fresh DB hit.
      const names = rows.map((r) => r.name);
      expect(names).not.toContain('Pune');
      expect(rows.length).toBe(EXPECTED_NAMES_ORDER.length - 1);
    } finally {
      await db
        .update(cities)
        .set({ isActive: true })
        .where(inArray(cities.name, ['Pune']));
    }
  });
});
