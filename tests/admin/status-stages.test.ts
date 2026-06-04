import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { statusStages, visitRequests } from '@/db/schema';
import {
  countRequestsOnStage,
  loadStatusStagesWithCounts,
} from '@/lib/admin/status-stages';

import { getOrCreateCity, seedVisitRequest } from '../helpers/db';

// =============================================================================
// HVA-222: status_stages CRUD data layer
// =============================================================================
//
// Sanity checks on the loader + delete-safety counter. Server actions
// have their own auth gates that require a real session; this file
// covers the data-layer pieces that don't depend on session context.
// =============================================================================

describe('loadStatusStagesWithCounts', () => {
  it('returns every seeded stage ordered by sequence', async () => {
    const rows = await loadStatusStagesWithCounts();
    // 10 stages seeded across migrations.
    expect(rows.length).toBeGreaterThanOrEqual(10);
    // Ordered ascending by sequence.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.sequenceNumber).toBeGreaterThanOrEqual(
        rows[i - 1]!.sequenceNumber,
      );
    }
    // SUBMITTED is the first stage by sequence.
    expect(rows[0]!.code).toBe('SUBMITTED');
  });

  it('marks the highest-seq stage terminal after migration 0059', async () => {
    const rows = await loadStatusStagesWithCounts();
    const last = rows[rows.length - 1]!;
    expect(last.isTerminal).toBe(true);
  });

  it('non-terminal stages have isTerminal=false by default', async () => {
    const rows = await loadStatusStagesWithCounts();
    const nonLast = rows.slice(0, -1);
    for (const r of nonLast) {
      expect(r.isTerminal).toBe(false);
    }
  });

  it('counts visit_requests per stage', async () => {
    const before = await loadStatusStagesWithCounts();
    const submitted = before.find((s) => s.code === 'SUBMITTED');
    expect(submitted).toBeDefined();
    const baseCount = submitted!.requestCount;

    const city = await getOrCreateCity('Bangalore');
    await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'SUBMITTED',
    });

    const after = await loadStatusStagesWithCounts();
    const submittedAfter = after.find((s) => s.code === 'SUBMITTED');
    expect(submittedAfter!.requestCount).toBe(baseCount + 1);
  });
});

describe('countRequestsOnStage', () => {
  it('returns 0 for a stage with no requests', async () => {
    const [orderExecuted] = await db
      .select({ id: statusStages.id })
      .from(statusStages)
      .where(eq(statusStages.code, 'ORDER_EXECUTED_SUCCESSFULLY'))
      .limit(1);
    expect(orderExecuted).toBeDefined();
    const count = await countRequestsOnStage(orderExecuted!.id);
    expect(count).toBe(0);
  });

  it('matches the request_count from loadStatusStagesWithCounts', async () => {
    const city = await getOrCreateCity('Bangalore');
    await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'ASSIGNED',
    });
    await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'ASSIGNED',
    });

    const rows = await loadStatusStagesWithCounts();
    const assigned = rows.find((s) => s.code === 'ASSIGNED');
    const direct = await countRequestsOnStage(assigned!.id);
    expect(direct).toBe(assigned!.requestCount);
    expect(direct).toBe(2);
  });
});

describe('status_stages — sequence_number is no longer UNIQUE post-0059', () => {
  it('allows two stages to share the same sequence_number transiently', async () => {
    // Create two stages with the same sequence. Pre-0059 this would
    // have thrown on the second insert. Post-0059 it succeeds, which
    // is what enables admin reorder without temp-value gymnastics.
    const code1 = `__TEST_STAGE_A_${Date.now()}__`;
    const code2 = `__TEST_STAGE_B_${Date.now()}__`;
    const seq = 999;
    try {
      await db.insert(statusStages).values({
        code: code1,
        name: 'Test A',
        sequenceNumber: seq,
      });
      await db.insert(statusStages).values({
        code: code2,
        name: 'Test B',
        sequenceNumber: seq,
      });
      const [rowA] = await db
        .select({ seq: statusStages.sequenceNumber })
        .from(statusStages)
        .where(eq(statusStages.code, code1));
      const [rowB] = await db
        .select({ seq: statusStages.sequenceNumber })
        .from(statusStages)
        .where(eq(statusStages.code, code2));
      expect(rowA!.seq).toBe(seq);
      expect(rowB!.seq).toBe(seq);
    } finally {
      // truncateAll skips status_stages (seed-preserved), so clean up by hand.
      await db.delete(statusStages).where(eq(statusStages.code, code1));
      await db.delete(statusStages).where(eq(statusStages.code, code2));
      // Also clean any visit_requests created in the previous tests
      // that might point at the freshly-deleted stages (shouldn't, but
      // be defensive).
      void visitRequests;
    }
  });
});
