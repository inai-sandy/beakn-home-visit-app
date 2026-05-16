import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { cities, statusStages, userRoleEnum } from '@/db/schema';

// =============================================================================
// HVA-101: smoke test — proves the harness boots, migrations applied, seeds
// in place. Runs first so a harness regression surfaces before suites that
// depend on it.
// =============================================================================

describe('test harness', () => {
  it('points DATABASE_URL at the testcontainer, not the dev/prod DB', () => {
    const url = process.env.DATABASE_URL ?? '';
    // Testcontainers exposes the DB on 127.0.0.1:<random-port>. The prod
    // env points at "beakn-postgres" (container DNS) and the dev/host
    // override points at 127.0.0.1:5432. Assert we have an ephemeral
    // port number.
    expect(url).toMatch(/(?:localhost|127\.0\.0\.1):\d{4,5}/);
    expect(url).not.toContain('beakn-postgres');
    expect(url).not.toContain(':5432/');
  });

  it('migrations applied: 9 cities + 10 status_stages seeded', async () => {
    const cityRows = await db.select({ id: cities.id }).from(cities);
    expect(cityRows.length).toBeGreaterThanOrEqual(9);

    const stageRows = await db
      .select({ code: statusStages.code })
      .from(statusStages);
    expect(stageRows.length).toBeGreaterThanOrEqual(10);
  });

  it('user_role enum exposes exactly [sales_executive, captain, super_admin]', () => {
    // Locks the schema source-of-truth so the next ship can't sneak in a
    // wrong-string role gate without a tsc + test failure. Matches the
    // HVA-106 audit finding.
    expect([...userRoleEnum.enumValues].sort()).toEqual(
      ['captain', 'sales_executive', 'super_admin'].sort(),
    );
  });
});
