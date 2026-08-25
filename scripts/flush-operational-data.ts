// Delete operational data while leaving configuration and identity intact.
//
// HVA-349. Written to give the app a clean operating history before the real
// sales-executive roster is imported, without destroying the things that took
// weeks to get right.
//
// WHAT THIS IS NOT: it is not "empty the database". Three groups of rows look
// like data but are actually the product's configuration, and losing them costs
// far more than the rows themselves:
//
//   * notification_rules (152) — every WhatsApp rule from HVA-343. Rebuilding
//     these means re-deriving 35 enabled rules across event x channel x role.
//   * cities (9) — captain ownership AND cartplus_store_id. This is HVA-348 and
//     the CartPlus store mapping; wiping it routes every incoming order to
//     "Other" and silences captain_owning_city notifications.
//   * status_stages / status_transitions — the workflow itself. visit_requests
//     references these with ON DELETE RESTRICT; the app cannot move an order
//     through a lifecycle that no longer exists.
//
// Identity is likewise preserved. sales_executives.captain_user_id is NOT NULL
// with ON DELETE RESTRICT, so a sales executive cannot even be imported unless
// their captain already exists. Flushing users would make the very next step
// impossible.
//
// SAFETY MODEL
//
//   1. The flush set is FK-closed and truncated WITHOUT cascade. If a table were
//      missed, Postgres raises instead of quietly reaching further. A failure
//      here is the guard working, not a bug to route around with CASCADE.
//   2. DRY_RUN is the default. Writing requires CONFIRM_FLUSH to equal the
//      database name, so a command copied into the wrong shell does nothing.
//   3. Everything runs in one transaction.
//
//   DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app \
//     pnpm tsx scripts/flush-operational-data.ts              # dry run
//
//   CONFIRM_FLUSH=beakn_app DATABASE_URL=... \
//     pnpm tsx scripts/flush-operational-data.ts              # writes
//
// Take a verified backup first. This is not recoverable from the app.

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

/**
 * Operational rows: the record of work done. Safe to clear for a fresh start.
 * The set is FK-closed — every table referencing one of these is also here.
 */
const FLUSH_TABLES = [
  // Orders and everything hanging off them
  'visit_requests',
  'quotations',
  'quotation_line_items',
  'request_status_history',
  'request_reschedule_history',
  'request_exec_assignments',
  'request_order_changes',
  'order_comments',
  'payments',
  // Pipeline and field work
  'leads',
  'tasks',
  'day_plans',
  'exec_unavailability_schedules',
  // Support
  'support_tickets',
  'support_ticket_messages',
  'admin_help_messages',
  // Dispatch
  'dispatches',
  'dispatch_items',
  'dispatch_status_history',
  'dispatch_requests',
  'dispatch_request_orders',
  'dispatch_request_items',
  // Retired Assist surface (HVA-342) — tables still present
  'assist_requests',
  'assist_request_items',
  'assist_request_status_history',
  // Performance management
  'warnings',
  'notes',
  // Delivery + audit trails
  'audit_log',
  'webhook_events',
  'in_app_notifications',
  'whatsapp_dispatches',
  'notifications_queue',
] as const;

/**
 * Named so the summary can state what survived. Anything in the database that
 * is in neither list is reported as unclassified rather than silently ignored —
 * a table added later must be a deliberate decision, not an oversight.
 */
const PRESERVE_TABLES = [
  // Identity and auth
  'users', 'accounts', 'sessions', 'verifications',
  'captains', 'sales_executives',
  'notification_preferences', 'push_subscriptions',
  // Configuration — the expensive stuff
  'cities', 'status_stages', 'status_transitions', 'notification_rules',
  'config', 'webhook_secrets',
  // Lookup tables
  'business_types', 'outcome_options', 'postpone_reasons',
  'resource_categories', 'resources', 'holidays',
  'announcement_categories', 'announcements', 'announcement_acknowledgments',
  'support_ticket_categories',
  'rate_limits', 'rate_limit_attempts',
] as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');

  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { casing: 'snake_case' });
  const log = (line: string) => console.log(`[flush] ${line}`);

  const [{ current_database: dbName }] = await db.execute<{ current_database: string }>(
    sql`SELECT current_database()`,
  );
  const confirm = process.env.CONFIRM_FLUSH ?? '';
  const dryRun = confirm !== dbName;

  log(`database: ${dbName}`);
  log(dryRun ? 'MODE: dry run (nothing will be written)' : 'MODE: WRITING');

  // Any table present in neither list is surfaced rather than assumed safe.
  const present = await db.execute<{ table_name: string }>(
    sql`SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_type='BASE TABLE'`,
  );
  const known = new Set<string>([...FLUSH_TABLES, ...PRESERVE_TABLES]);
  const unclassified = present
    .map((r) => r.table_name)
    .filter((t) => !known.has(t) && t !== 'drizzle_migrations' && t !== '__drizzle_migrations');
  if (unclassified.length > 0) {
    throw new Error(
      `Unclassified table(s): ${unclassified.join(', ')}.\n` +
        'Add each to FLUSH_TABLES or PRESERVE_TABLES. Refusing to run against a\n' +
        'schema this script does not fully account for.',
    );
  }

  let totalToDelete = 0;
  log('--- rows to be DELETED ---');
  for (const table of FLUSH_TABLES) {
    const [row] = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM ${sql.identifier(table)}`,
    );
    const n = Number(row.n);
    totalToDelete += n;
    if (n > 0) log(`  ${table.padEnd(32)} ${n}`);
  }
  log(`  TOTAL ${totalToDelete}`);

  log('--- rows PRESERVED ---');
  for (const table of PRESERVE_TABLES) {
    const [row] = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM ${sql.identifier(table)}`,
    );
    const n = Number(row.n);
    if (n > 0) log(`  ${table.padEnd(32)} ${n}`);
  }

  if (dryRun) {
    log('');
    log('DRY RUN — nothing was written.');
    log(`To execute: CONFIRM_FLUSH=${dbName}`);
    await client.end();
    return;
  }

  // One statement, no CASCADE: Postgres verifies the set is FK-closed for us.
  // RESTART IDENTITY so sequence-backed numbering starts clean too.
  const list = FLUSH_TABLES.map((t) => `"${t}"`).join(', ');
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY`));
  });
  log(`truncated ${FLUSH_TABLES.length} tables (${totalToDelete} rows)`);

  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[flush] failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
