import { describe, expect, it } from 'vitest';

import { roleLabel } from '@/lib/notes/types';

// =============================================================================
// HVA-237: roleLabel — display label for note + comment-thread authors.
// =============================================================================

describe('roleLabel', () => {
  it('sales_executive → "Sales Exec"', () => {
    expect(roleLabel('sales_executive')).toBe('Sales Exec');
  });

  it('captain → "Captain"', () => {
    expect(roleLabel('captain')).toBe('Captain');
  });

  it('super_admin → "Admin"', () => {
    expect(roleLabel('super_admin')).toBe('Admin');
  });

  // HVA-237: support added so future comment threads in HVA-231 Phase 3
  // don't render the raw "support" enum value.
  it('support → "Support"', () => {
    expect(roleLabel('support')).toBe('Support');
  });
});
