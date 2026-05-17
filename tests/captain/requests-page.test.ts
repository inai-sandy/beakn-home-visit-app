import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { cities, statusStages, visitRequests } from '@/db/schema';
import { loadCaptainCityIds } from '@/lib/captain/cities';
import {
  categorizeRequest,
  TERMINAL_POSITIVE_STATUS_CODES,
} from '@/lib/captain/request-buckets';
import { maskCustomerPhone } from '@/lib/format/phone';

import { seedCaptain, seedVisitRequest } from '../helpers/db';

// =============================================================================
// HVA-127: captain requests-list authority + helpers
// =============================================================================
//
// Tests focus on the data-layer authority that powers /captain/requests:
//   - `loadCaptainCityIds(actorId)` returns the right cities
//   - the inArray(visit_requests.city_id, [...]) filter shape returns the
//     right rows (assert via direct Drizzle query — bypasses the React
//     server-component render, which HVA-101 harness doesn't run)
//   - bucket categorization (open / assigned / completed / cancelled)
//
// The page component itself is a thin wrapper that runs the same query
// + bucket helper — covered structurally via the helper tests + a live
// browser walk by Sandeep.
// =============================================================================

async function captainsCityNames(captainId: string): Promise<string[]> {
  const rows = await db
    .select({ name: cities.name })
    .from(cities)
    .where(eq(cities.captainUserId, captainId));
  return rows.map((r) => r.name).sort();
}

async function assignCityToCaptain(cityName: string, captainId: string) {
  await db
    .update(cities)
    .set({ captainUserId: captainId })
    .where(eq(cities.name, cityName));
}

async function getCityIdByName(name: string): Promise<string> {
  const [row] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.name, name))
    .limit(1);
  return row.id;
}

describe('loadCaptainCityIds + ownership filter', () => {
  it('returns only the cities the captain owns; "Other" is excluded by construction', async () => {
    const cap = await seedCaptain();
    await assignCityToCaptain('Bangalore', cap.id);
    await assignCityToCaptain('Hyderabad', cap.id);
    const ids = await loadCaptainCityIds(cap.id);
    expect(ids).toHaveLength(2);

    const names = await captainsCityNames(cap.id);
    expect(names).toEqual(['Bangalore', 'Hyderabad']);
    expect(names).not.toContain('Other'); // Other has captain_user_id=NULL
  });

  it('captain with no city assignments returns empty array', async () => {
    const cap = await seedCaptain();
    const ids = await loadCaptainCityIds(cap.id);
    expect(ids).toEqual([]);
  });

  it('captain sees their own-city requests across all statuses', async () => {
    const cap = await seedCaptain();
    await assignCityToCaptain('Bangalore', cap.id);
    const cityId = await getCityIdByName('Bangalore');

    // Seed 3 requests at different stages in Bangalore.
    await seedVisitRequest({
      cityId,
      statusStageCode: 'SUBMITTED',
    });
    await seedVisitRequest({
      cityId,
      statusStageCode: 'ASSIGNED',
      assignedExecUserId: cap.id,
    });
    await seedVisitRequest({
      cityId,
      statusStageCode: 'ORDER_EXECUTED_SUCCESSFULLY',
    });

    const myCityIds = await loadCaptainCityIds(cap.id);
    const rows = await db
      .select({
        id: visitRequests.id,
        statusCode: statusStages.code,
      })
      .from(visitRequests)
      .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
      .where(eq(visitRequests.cityId, myCityIds[0]));
    expect(rows).toHaveLength(3);
    const codes = rows.map((r) => r.statusCode).sort();
    expect(codes).toEqual(['ASSIGNED', 'ORDER_EXECUTED_SUCCESSFULLY', 'SUBMITTED']);
  });

  it("captain does NOT see another captain's city requests", async () => {
    const capA = await seedCaptain({ phone: '+919001112221' });
    const capB = await seedCaptain({ phone: '+919001112222' });
    await assignCityToCaptain('Bangalore', capA.id);
    await assignCityToCaptain('Hyderabad', capB.id);
    const bangaloreId = await getCityIdByName('Bangalore');
    const hyderabadId = await getCityIdByName('Hyderabad');

    await seedVisitRequest({ cityId: bangaloreId }); // capA's
    await seedVisitRequest({ cityId: hyderabadId }); // capB's

    const capAIds = await loadCaptainCityIds(capA.id);
    const capARows = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(eq(visitRequests.cityId, capAIds[0]));
    expect(capARows).toHaveLength(1);

    const capBIds = await loadCaptainCityIds(capB.id);
    const capBRows = await db
      .select({ id: visitRequests.id })
      .from(visitRequests)
      .where(eq(visitRequests.cityId, capBIds[0]));
    expect(capBRows).toHaveLength(1);
    // Cross-check: capA's id list does NOT contain capB's city id.
    expect(capAIds).not.toContain(capBIds[0]);
  });

  it("'Other' city has captain_user_id NULL — never appears in any captain's id list", async () => {
    const cap = await seedCaptain();
    await assignCityToCaptain('Bangalore', cap.id);
    const otherId = await getCityIdByName('Other');
    const ids = await loadCaptainCityIds(cap.id);
    expect(ids).not.toContain(otherId);
  });

  it('retro-visibility: pre-existing Submitted Hyderabad request appears once the captain owns the city', async () => {
    // Mimics today's prod scenario: request landed BEFORE the captain
    // ownership was wired. Captain visibility kicks in via the cities
    // row, no per-request backfill needed.
    const hyderabadId = await getCityIdByName('Hyderabad');
    await seedVisitRequest({
      cityId: hyderabadId,
      statusStageCode: 'SUBMITTED',
      // No assigned_captain_user_id, no assigned_exec_user_id — orphan.
    });

    const cap = await seedCaptain();
    await assignCityToCaptain('Hyderabad', cap.id);

    const ids = await loadCaptainCityIds(cap.id);
    const rows = await db
      .select({ id: visitRequests.id, statusCode: statusStages.code })
      .from(visitRequests)
      .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
      .where(eq(visitRequests.cityId, ids[0]));
    expect(rows).toHaveLength(1);
    expect(rows[0].statusCode).toBe('SUBMITTED');
  });
});

describe('categorizeRequest bucket logic', () => {
  it('cancelled_at NOT NULL → cancelled (regardless of status)', () => {
    expect(
      categorizeRequest({
        statusCode: 'SUBMITTED',
        assignedExecUserId: null,
        cancelledAt: new Date(),
      }),
    ).toBe('cancelled');
    expect(
      categorizeRequest({
        statusCode: 'ORDER_EXECUTED_SUCCESSFULLY',
        assignedExecUserId: '019e0000-0000-0000-0000-000000000001',
        cancelledAt: new Date(),
      }),
    ).toBe('cancelled');
  });

  it('ORDER_EXECUTED_SUCCESSFULLY (terminal positive) → completed', () => {
    expect(
      categorizeRequest({
        statusCode: 'ORDER_EXECUTED_SUCCESSFULLY',
        assignedExecUserId: '019e0000-0000-0000-0000-000000000001',
        cancelledAt: null,
      }),
    ).toBe('completed');
  });

  it('assigned exec, not terminal → assigned', () => {
    expect(
      categorizeRequest({
        statusCode: 'VISIT_SCHEDULED',
        assignedExecUserId: '019e0000-0000-0000-0000-000000000001',
        cancelledAt: null,
      }),
    ).toBe('assigned');
  });

  it('no exec, not terminal → open', () => {
    expect(
      categorizeRequest({
        statusCode: 'SUBMITTED',
        assignedExecUserId: null,
        cancelledAt: null,
      }),
    ).toBe('open');
  });

  it('TERMINAL_POSITIVE_STATUS_CODES is the single source of truth', () => {
    expect(TERMINAL_POSITIVE_STATUS_CODES).toContain(
      'ORDER_EXECUTED_SUCCESSFULLY',
    );
    // Adding a new positive-terminal stage = update this array + this test.
    expect(TERMINAL_POSITIVE_STATUS_CODES).toHaveLength(1);
  });
});

describe('maskCustomerPhone', () => {
  it('+91 + 10 digits → +91 NNN-XXX-NNNN', () => {
    expect(maskCustomerPhone('+919949999599')).toBe('+91 994-XXX-9599');
  });

  it('malformed input returns the raw string (never throws)', () => {
    expect(maskCustomerPhone('not-a-phone')).toBe('not-a-phone');
    expect(maskCustomerPhone('+919876')).toBe('+919876');
    // Non-string passthrough — coerced safely.
    // @ts-expect-error intentional bad input
    expect(maskCustomerPhone(null)).toBe('');
  });

  it('keeps the +91 country prefix visible', () => {
    expect(maskCustomerPhone('+919876543210')).toMatch(/^\+91 /u);
  });
});
