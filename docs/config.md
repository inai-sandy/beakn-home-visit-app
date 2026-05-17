# Runtime configuration (`lib/config`)

## Model

Admin-tunable values live in the `config` table (one row per key). Read via `getConfig(key)`, written via `setConfig(key, value, actor?)`. The full key catalogue + per-key validation + defaults live in `lib/config-schema.ts`.

Both helpers always hit Postgres. There is **no in-memory cache**. Removed in HVA-112 — a 60-second `Map`-based TTL cache that was generating staleness on admin PATCH operations and earned no measurable performance benefit (single-worker prod deploy, ~1 read/hour load).

## API

```ts
// Read — always reads from DB.
const phone = await getConfig('customer_support_phone'); // typed via ConfigValueOf<K>

// Write — UPSERTs the row + emits a `configuration_change` audit event.
await setConfig('day_plan_cutoff_time', '09:30');

// Admin write: pass `actor` so the audit row attributes the change.
await setConfig('customer_support_phone', '+919876543210', {
  userId: session.user.id,
  role: 'super_admin',
  ipAddress: req.headers.get('x-forwarded-for') ?? null,
  userAgent: req.headers.get('user-agent'),
});
```

`actor` is optional. Internal callers (seed scripts, system events) leave it undefined and the audit row records `actor_user_id = null` and `actor_role = null`. Admin write surfaces should always pass it — the previous workaround of writing the audit row by hand (HVA-105 era) is no longer needed.

## When to add caching

Don't yet. Production read frequency at the time of HVA-112 was ~1 read/hour and Postgres p50 for an indexed key lookup is sub-millisecond — the previous cache earned approximately zero wall-clock benefit.

**Upgrade path when read patterns change.** If a single React render starts reading multiple config keys (e.g. an Admin Settings Hub renders 20+ keys in one page), wrap `getConfig` calls in React's `cache()` for per-render memoization:

```ts
import { cache } from 'react';
import { getConfig as rawGetConfig } from '@/lib/config';

export const getConfigCached = cache(rawGetConfig);
// Now a Server Component that calls getConfigCached('foo') three times
// during the same render hits the DB once. Across requests there is
// no shared state, so admin PATCH writes are immediately visible to
// the next render with no invalidation logic.
```

This is the same pattern HVA-100 established for `getCitiesForRequestForm`. Per-request deduplication only — never holds state past the request. Zero cross-request staleness possible. Adopt it surgically (only on hot paths that actually need it); don't blanket-wrap `getConfig` because doing so adds indirection for no benefit on cold reads.

**Don't reintroduce a process-level cache** unless the read frequency becomes high enough to make Postgres a measurable bottleneck (>100 reads/sec sustained per worker). At that point Redis or another shared cache is the right answer, not a per-worker `Map` — that's exactly the design that HVA-112 retired.

## Adding a new config key

1. Add an entry to `CONFIG_SCHEMA` in `lib/config-schema.ts` with `type`, `category`, `description`, `defaultValue`, `editable`, and optional `validation` (`pattern` / `enumValues` / `min` / `max`).
2. Decide whether the default belongs in prod immediately. If yes, write a new migration `db/migrations/NNNN_<issue>_seed_<key>.sql` that `INSERT … ON CONFLICT (key) DO NOTHING`s the row. The HVA-111 runner picks it up automatically; no journal handling.
3. If the key triggers a new audit `event_type`, also extend the `audit_enabled_events` array — both in the migration AND in `lib/config-schema.ts > CONFIG_SCHEMA.audit_enabled_events.defaultValue` (the harness reads the default, the migration updates prod). The HVA-108 dual-write pattern still applies to allow-list extensions — that's an audit-system invariant, not a cache concern, so HVA-112 didn't change it.
4. Run `pnpm db:migrate` locally; commit the migration file.

## Audit attribution

Every `setConfig` call emits an `audit_log` row with `event_type = 'configuration_change'`. `before_state` and `after_state` are the wrapped JSONB values (`{ "value": <prev> }` / `{ "value": <new> }`). `actor_user_id` + `actor_role` + `ip_address` + `user_agent` come from the `actor` parameter when supplied.

`configuration_change` is included in the default `audit_enabled_events` allow-list (`lib/config-schema.ts`), so the row is written without any further config gymnastics.

## Schema TS / SQL sync

`config` is in `db/schema/config.ts`. JSONB column for `value`; one row per `key`. The Drizzle type is `unknown` — `lib/config` validates and narrows. If you change the table shape, follow `docs/migrations.md` for the SQL migration; the schema TS and SQL stay in sync by hand.
