import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { warnings } from '@/db/schema';
import {
  composeHardWarningMessage,
  composeSoftWarningMessage,
} from '@/lib/warnings/compose';
import {
  HARD_WARNING_FIRE_THRESHOLD,
  formatMetricValue,
} from '@/lib/warnings/metrics';
import {
  loadActiveWarningCounts,
  loadAdminExecWarningRoster,
  loadWarningHistory,
} from '@/lib/warnings/queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
} from '../helpers/db';

// =============================================================================
// HVA-228: warnings tests
// =============================================================================
//
// Covers:
//  - formatMetricValue rounding + currency formatting
//  - composeSoftWarning / composeHardWarning template rendering
//  - loadActiveWarningCounts ignores revoked rows + flips fireFlag at 5
//  - loadWarningHistory orders by createdAt desc + resolves revoker name
//  - loadAdminExecWarningRoster aggregates soft + hard per exec
// =============================================================================

beforeEach(async () => {
  await getOrCreateCity('Bangalore');
});

describe('formatMetricValue', () => {
  it('renders paise as INR with no decimals', () => {
    expect(formatMetricValue(150000, 'paise')).toBe('₹1,500');
  });

  it('renders count as plain integer with locale formatting', () => {
    expect(formatMetricValue(12345, 'count')).toBe('12,345');
  });

  it('renders percent as one-decimal % (stored as tenths)', () => {
    expect(formatMetricValue(475, 'percent')).toBe('47.5%');
  });
});

describe('composeSoftWarningMessage', () => {
  it('includes the exec name, metric, period, current/target, and reason', () => {
    const msg = composeSoftWarningMessage({
      kind: 'soft',
      execName: 'Veera',
      captainName: 'Captain B',
      metricCode: 'revenue',
      periodCode: 'this_month',
      currentValue: 80_000_00,
      targetValue: 1_50_000_00,
      reason: 'Behind on monthly target by 47%.',
    });
    expect(msg).toContain('Veera');
    expect(msg).toContain('Revenue collected');
    expect(msg).toContain('This month');
    expect(msg).toContain('₹80,000');
    expect(msg).toContain('₹1,50,000');
    expect(msg).toContain('Behind on monthly target by 47%.');
    expect(msg).toContain('Sandeep');
  });
});

describe('composeHardWarningMessage', () => {
  it('includes the hardCount / threshold and captain name', () => {
    const msg = composeHardWarningMessage({
      kind: 'hard',
      execName: 'Veera',
      captainName: 'Captain B',
      metricCode: 'orders',
      periodCode: 'this_month',
      currentValue: 1,
      targetValue: 10,
      reason: 'Repeated misses after two soft warnings.',
      hardCount: 3,
    });
    expect(msg).toContain('hard warning 3/5');
    expect(msg).toContain('Captain B');
    expect(msg).toContain('Repeated misses after two soft warnings.');
    expect(msg).toContain('Orders confirmed');
  });
});

describe('loadActiveWarningCounts', () => {
  it('returns zero counts + fireFlag=false for an exec with no warnings', async () => {
    const captain = await seedCaptain({ phone: '+919910000001' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919910000002',
      fullName: 'Exec A',
    });
    const counts = await loadActiveWarningCounts(exec.id);
    expect(counts).toEqual({
      softActive: 0,
      hardActive: 0,
      hardThreshold: HARD_WARNING_FIRE_THRESHOLD,
      fireFlag: false,
    });
  });

  it('counts active soft+hard but ignores revoked', async () => {
    const captain = await seedCaptain({ phone: '+919910000010' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919910000011',
      fullName: 'Exec B',
    });
    // 2 active soft, 1 active hard, 1 REVOKED soft
    await db.insert(warnings).values([
      {
        execUserId: exec.id,
        kind: 'soft',
        metricCode: 'revenue',
        periodLabel: 'This month',
        currentValue: 0,
        targetValue: 100,
        reason: 'r',
        messageSnapshot: 'm',
        issuedByUserId: captain.id,
      },
      {
        execUserId: exec.id,
        kind: 'soft',
        metricCode: 'orders',
        periodLabel: 'This month',
        currentValue: 0,
        targetValue: 100,
        reason: 'r',
        messageSnapshot: 'm',
        issuedByUserId: captain.id,
      },
      {
        execUserId: exec.id,
        kind: 'soft',
        metricCode: 'orders',
        periodLabel: 'This month',
        currentValue: 0,
        targetValue: 100,
        reason: 'r',
        messageSnapshot: 'm',
        issuedByUserId: captain.id,
        revokedAt: new Date(),
        revokedByUserId: captain.id,
        revokedReason: 'misclick',
      },
      {
        execUserId: exec.id,
        kind: 'hard',
        metricCode: 'orders',
        periodLabel: 'This month',
        currentValue: 0,
        targetValue: 100,
        reason: 'r',
        messageSnapshot: 'm',
        issuedByUserId: captain.id,
      },
    ]);
    const counts = await loadActiveWarningCounts(exec.id);
    expect(counts.softActive).toBe(2);
    expect(counts.hardActive).toBe(1);
    expect(counts.fireFlag).toBe(false);
  });

  it('flips fireFlag=true when active hard reaches 5', async () => {
    const captain = await seedCaptain({ phone: '+919910000020' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919910000021',
      fullName: 'Exec C',
    });
    await db.insert(warnings).values(
      Array.from({ length: 5 }).map(() => ({
        execUserId: exec.id,
        kind: 'hard' as const,
        metricCode: 'revenue',
        periodLabel: 'This month',
        currentValue: 0,
        targetValue: 100,
        reason: 'r',
        messageSnapshot: 'm',
        issuedByUserId: captain.id,
      })),
    );
    const counts = await loadActiveWarningCounts(exec.id);
    expect(counts.hardActive).toBe(5);
    expect(counts.fireFlag).toBe(true);
  });
});

describe('loadWarningHistory', () => {
  it('returns rows in desc-created order with issuer/revoker names', async () => {
    const captain = await seedCaptain({ phone: '+919910000030' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919910000031',
      fullName: 'Exec D',
    });
    // Insert two warnings with a small gap so order is deterministic.
    await db.insert(warnings).values({
      execUserId: exec.id,
      kind: 'soft',
      metricCode: 'revenue',
      periodLabel: 'This month',
      currentValue: 0,
      targetValue: 100,
      reason: 'first',
      messageSnapshot: 'm1',
      issuedByUserId: captain.id,
    });
    await new Promise((r) => setTimeout(r, 15));
    const [latest] = await db
      .insert(warnings)
      .values({
        execUserId: exec.id,
        kind: 'hard',
        metricCode: 'revenue',
        periodLabel: 'This month',
        currentValue: 0,
        targetValue: 100,
        reason: 'second',
        messageSnapshot: 'm2',
        issuedByUserId: captain.id,
      })
      .returning({ id: warnings.id });
    await db
      .update(warnings)
      .set({
        revokedAt: new Date(),
        revokedByUserId: captain.id,
        revokedReason: 'misclick',
      })
      .where(eq(warnings.id, latest.id));

    const rows = await loadWarningHistory(exec.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].reason).toBe('second');
    expect(rows[0].revokedByName).not.toBeNull();
    expect(rows[1].reason).toBe('first');
  });
});

describe('loadAdminExecWarningRoster', () => {
  it('returns one entry per active exec with their counts', async () => {
    const captain = await seedCaptain({ phone: '+919910000040' });
    const execA = await seedExecutive(captain.id, {
      phone: '+919910000041',
      fullName: 'Exec Alpha',
    });
    const execB = await seedExecutive(captain.id, {
      phone: '+919910000042',
      fullName: 'Exec Bravo',
    });

    await db.insert(warnings).values({
      execUserId: execA.id,
      kind: 'soft',
      metricCode: 'orders',
      periodLabel: 'This month',
      currentValue: 0,
      targetValue: 100,
      reason: 'r',
      messageSnapshot: 'm',
      issuedByUserId: captain.id,
    });

    const roster = await loadAdminExecWarningRoster();
    const a = roster.find((r) => r.execUserId === execA.id);
    const b = roster.find((r) => r.execUserId === execB.id);
    expect(a?.softActive).toBe(1);
    expect(a?.hardActive).toBe(0);
    expect(b?.softActive).toBe(0);
    expect(b?.captainName).toBeDefined();
  });
});
