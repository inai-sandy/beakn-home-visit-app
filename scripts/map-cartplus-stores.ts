// Map CartPlus stores onto Beakn cities.
//
// HVA-348 follow-on. `resolveCity()` in the order webhook looks a city up by
// `cities.cartplus_store_id`; an unmapped store falls back to the `Other` city,
// which by design has no captain. So an unmapped store means every order from
// it is attributed to nowhere and every `captain_owning_city` notification for
// it resolves to nothing — the message is enabled and lands on no one.
//
// When this was written, five live per-city stores were unmapped: Pune,
// Mumbai, Vizag, Vijayawada and the real Hyderabad store. Between them they had
// taken ~32 orders in the preceding week, all of which landed on `Other`.
//
// One store per city: `cartplus_store_id` lives on the city row, so pointing a
// city at a new store necessarily unpoints it from the old one, and orders from
// the old store begin falling back to `Other`. That is why this prints the
// displacement rather than performing it quietly.
//
//   STORE_MAP_JSON='[{"city":"Pune","storeId":81}]' \
//   DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app \
//     pnpm tsx scripts/map-cartplus-stores.ts
//
// DRY_RUN=1 prints the plan and writes nothing.

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { cities } from '../db/schema/org';

interface StoreMapping {
  city: string;
  storeId: number;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const raw = process.env.STORE_MAP_JSON;
  if (!raw || raw.trim() === '') {
    throw new Error('STORE_MAP_JSON is not set. See the header for the shape.');
  }
  const dryRun = process.env.DRY_RUN === '1';
  const mappings = JSON.parse(raw) as StoreMapping[];
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new Error('STORE_MAP_JSON must be a non-empty array');
  }

  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { casing: 'snake_case' });
  const log = (l: string) => console.log(`[map:stores] ${l}`);
  // Cities this run maps, so the closing summary stays truthful under DRY_RUN
  // where nothing is written and a re-read would list them all as unmapped.
  const mapped = new Set<string>();

  for (const { city: cityName, storeId } of mappings) {
    if (!Number.isInteger(storeId)) {
      throw new Error(`storeId for '${cityName}' must be an integer`);
    }

    const [city] = await db
      .select({ id: cities.id, current: cities.cartplusStoreId })
      .from(cities)
      .where(eq(cities.name, cityName))
      .limit(1);
    if (!city) throw new Error(`city '${cityName}' does not exist`);

    // A store already pointing at a DIFFERENT city would be silently stolen,
    // sending that city's orders to `Other` from the next webhook onward.
    const [claimedBy] = await db
      .select({ name: cities.name })
      .from(cities)
      .where(eq(cities.cartplusStoreId, storeId))
      .limit(1);
    if (claimedBy && claimedBy.name !== cityName) {
      throw new Error(
        `store ${storeId} is already mapped to '${claimedBy.name}'. Remap that ` +
          'city first — a store cannot serve two cities.',
      );
    }

    if (city.current === storeId) {
      log(`${cityName}: already store ${storeId}`);
      continue;
    }
    if (city.current != null) {
      log(
        `${cityName}: store ${city.current} -> ${storeId} — orders from ` +
          `${city.current} will now fall back to 'Other'`,
      );
    } else {
      log(`${cityName}: store ${storeId} (was unmapped, orders went to 'Other')`);
    }
    mapped.add(cityName);
    if (!dryRun) {
      await db
        .update(cities)
        .set({ cartplusStoreId: storeId, updatedAt: new Date() })
        .where(eq(cities.id, city.id));
    }
  }

  const all = await db
    .select({ name: cities.name, store: cities.cartplusStoreId })
    .from(cities);
  const unmapped = all.filter(
    (c) => c.store == null && c.name !== 'Other' && !mapped.has(c.name),
  );
  if (unmapped.length > 0) {
    log(
      `cities with NO CartPlus store: ${unmapped.map((c) => c.name).join(', ')} — ` +
        'not live in CartPlus, or awaiting a mapping',
    );
  } else {
    log('every city has a store');
  }

  if (dryRun) log('DRY RUN — nothing was written');
  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[map:stores] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
