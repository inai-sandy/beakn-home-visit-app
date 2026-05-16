import { cache } from 'react';
import { asc, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { cities } from '@/db/schema';

// =============================================================================
// HVA-100: cities list helper for the public /request form
// =============================================================================
//
// Single source of truth for the city dropdown on /request, replacing
// the two hardcoded TS consts that HVA-31 added when the seed migration
// didn't yet exist (names + state-defaults — both gone as of this ship).
//
// Wrapped in React's `cache()` so multiple consumers within one render
// (e.g. the server-component page + any other server consumer) hit the
// DB once per request. No cross-request caching: admin edits via the
// cities admin UI (HVA-110) need to land on the next request immediately,
// and 9 rows is a sub-ms query.
//
// Ordering: alphabetical, "Other" last. The SQL `(name = 'Other')`
// expression evaluates to boolean — false sorts before true under
// ASC, so the synthetic-feeling "Other" row falls to the bottom even
// though it's a real DB row.
// =============================================================================

export interface CityOption {
  id: string;
  name: string;
  /** NULL on the "Other" row; the State field stays empty for that case. */
  state: string | null;
}

export const getCitiesForRequestForm = cache(async (): Promise<CityOption[]> => {
  return db
    .select({
      id: cities.id,
      name: cities.name,
      state: cities.state,
    })
    .from(cities)
    .where(eq(cities.isActive, true))
    .orderBy(sql`(${cities.name} = 'Other') ASC`, asc(cities.name));
});
