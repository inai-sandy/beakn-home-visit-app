import { describe, expect, it } from 'vitest';

import {
  leadAvatarColorClass,
  leadAvatarInitial,
} from '@/components/leads/LeadAvatar';

// =============================================================================
// HVA-73 follow-up: LeadAvatar pure helpers
// =============================================================================

describe('leadAvatarColorClass', () => {
  it('is deterministic — same name produces the same colour class', () => {
    const a = leadAvatarColorClass('Sandy Karnati');
    const b = leadAvatarColorClass('Sandy Karnati');
    expect(a).toBe(b);
  });

  it('different names usually map to different colours (sanity check)', () => {
    // Not a strict guarantee with a name-hash modulo a small palette, but
    // these five distinct samples should split across at least two
    // colours — guards against a stuck hash output.
    const colors = new Set([
      leadAvatarColorClass('Sandy Karnati'),
      leadAvatarColorClass('Aisha Khan'),
      leadAvatarColorClass('Vikram Rao'),
      leadAvatarColorClass('Meera Iyer'),
      leadAvatarColorClass('Rohan Verma'),
    ]);
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it('empty / null name returns the muted fallback class, not a palette entry', () => {
    expect(leadAvatarColorClass(null)).toBe('bg-muted');
    expect(leadAvatarColorClass('')).toBe('bg-muted');
    expect(leadAvatarColorClass('   ')).toBe('bg-muted');
  });
});

describe('leadAvatarInitial', () => {
  it('returns the first letter uppercased', () => {
    expect(leadAvatarInitial('alice')).toBe('A');
    expect(leadAvatarInitial('Bob')).toBe('B');
  });

  it('skips leading punctuation / emoji to the first alphanumeric grapheme', () => {
    expect(leadAvatarInitial('  alice')).toBe('A');
    expect(leadAvatarInitial('!alice')).toBe('A');
  });

  it('returns "?" for empty input', () => {
    expect(leadAvatarInitial(null)).toBe('?');
    expect(leadAvatarInitial('')).toBe('?');
    expect(leadAvatarInitial('   ')).toBe('?');
  });
});
