import { asc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { cities } from '@/db/schema';

// =============================================================================
// HVA-127: captain → cities ownership lookup
// =============================================================================
//
// Captain visibility throughout the captain portal is driven by
// `cities.captain_user_id`. Centralising the lookup in one helper:
//   * /captain/requests             — all requests across owned cities
//   * /captain/requests/unassigned  — Submitted+unassigned subset
//   * future: /captain/dashboard counters (HVA-80), /captain/approvals (HVA-83)
//
// "Other" pseudo-city has `captain_user_id = NULL` by design (HVA-42
// routing handles it separately). The eq() filter excludes any row
// where captain_user_id IS NULL, so Other can never appear in any
// captain's list by construction.
// =============================================================================

export interface CaptainCity {
  id: string;
  name: string;
}

export async function loadCaptainCities(
  actorUserId: string,
): Promise<CaptainCity[]> {
  return db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.captainUserId, actorUserId))
    .orderBy(asc(cities.name));
}

export async function loadCaptainCityIds(
  actorUserId: string,
): Promise<string[]> {
  const rows = await loadCaptainCities(actorUserId);
  return rows.map((c) => c.id);
}
