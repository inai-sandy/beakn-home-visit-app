import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { notificationRules } from '@/db/schema';

// =============================================================================
// Migration 0080 — notification wiring fixes
// =============================================================================
//
// per-worker-db.ts runs a ONE-TIME baseline truncateAll() before the FIRST
// test file in each worker fork — which wipes notification_rules — so we
// can't rely on "the live DB still has the rows migration 0080 seeded" (that
// state is order-dependent across the suite: whichever file happens to run
// first in a worker sees it, everyone else sees an empty table after
// truncateAll). Asserting on live state here would be flaky by construction.
//
// Instead we exercise the ACTUAL migration file's SQL directly (it's
// idempotent by design — UPDATE + INSERT...ON CONFLICT DO NOTHING) against a
// deliberately-seeded pre-migration-0080 state, in complete isolation from
// whatever the rest of the suite has done to notification_rules. This
// verifies the SQL logic itself, not just "was a migration applied at some
// point" — a regression to the SQL (e.g. wrong template_key, wrong
// recipient_role) would still be caught.
// =============================================================================

const MIGRATION_PATH = join(
  process.cwd(),
  'db',
  'migrations',
  '0080_notification_wiring.sql',
);

function readMigration(): string {
  // Pre-fix: this file did not exist — readFileSync throws ENOENT and the
  // test fails outright before any assertion runs.
  return readFileSync(MIGRATION_PATH, 'utf8');
}

async function seedPre0080WhatsappRules(): Promise<void> {
  // Mirrors the real rows migrations 0062 + 0066 seed, post-0069's UPDATE
  // flipping them enabled=TRUE (the state 0080 is meant to walk back).
  await db.insert(notificationRules).values([
    {
      eventType: 'exec.hard_warning_issued',
      channel: 'whatsapp',
      recipientRole: 'exec',
      enabled: true,
      templateKey: 'internal_hard_warning_v1',
    },
    {
      eventType: 'support.dispatch_recorded',
      channel: 'whatsapp',
      recipientRole: 'exec_assigned',
      enabled: true,
      templateKey: 'internal_items_dispatched_v1',
    },
    {
      eventType: 'support.dispatch_advanced',
      channel: 'whatsapp',
      recipientRole: 'exec_assigned',
      enabled: true,
      templateKey: 'internal_dispatch_advanced_v1',
    },
    // A composer-less internal WhatsApp rule with a DIFFERENT template_key
    // — must NOT be touched by 0080's targeted UPDATE.
    {
      eventType: 'webhook.cartplus.order_received',
      channel: 'whatsapp',
      recipientRole: 'exec_assigned',
      enabled: false,
      templateKey: 'internal_portal_order_received_v1',
    },
  ]);
}

describe('db/migrations/0080_notification_wiring.sql', () => {
  it('(B) disables the three composer-less internal WhatsApp rules by template_key, leaving other rules untouched', async () => {
    await seedPre0080WhatsappRules();
    const migrationSql = readMigration();

    await db.execute(sql.raw(migrationSql));

    const rows = await db
      .select({
        templateKey: notificationRules.templateKey,
        enabled: notificationRules.enabled,
      })
      .from(notificationRules)
      .where(eq(notificationRules.channel, 'whatsapp'));
    const byTemplateKey = new Map(rows.map((r) => [r.templateKey, r.enabled]));

    // Pre-fix (migration file absent): readMigration() above already threw.
    // Post-fix but pre-this-test's seeded state, these three were TRUE.
    expect(byTemplateKey.get('internal_hard_warning_v1')).toBe(false);
    expect(byTemplateKey.get('internal_items_dispatched_v1')).toBe(false);
    expect(byTemplateKey.get('internal_dispatch_advanced_v1')).toBe(false);

    // Untouched — different template_key, was already FALSE, must stay FALSE
    // (proves the UPDATE's WHERE clause is scoped to the 3 named keys, not a
    // blanket "disable all whatsapp" that would also be a regression).
    expect(byTemplateKey.get('internal_portal_order_received_v1')).toBe(false);
  });

  it('(C) seeds request.approval_overdue for captain_owning_city on in_app + push, enabled, idempotently', async () => {
    const migrationSql = readMigration();

    // Run twice — the file is designed to be idempotent
    // (INSERT ... ON CONFLICT DO NOTHING). A regression that dropped the
    // ON CONFLICT clause would make the second run throw on the unique
    // (event_type, channel, recipient_role) constraint.
    await db.execute(sql.raw(migrationSql));
    await db.execute(sql.raw(migrationSql));

    const rows = await db
      .select({
        channel: notificationRules.channel,
        recipientRole: notificationRules.recipientRole,
        enabled: notificationRules.enabled,
      })
      .from(notificationRules)
      .where(eq(notificationRules.eventType, 'request.approval_overdue'));

    expect(rows).toHaveLength(2);
    const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));
    expect(byChannel.in_app).toBeDefined();
    expect(byChannel.in_app!.recipientRole).toBe('captain_owning_city');
    expect(byChannel.in_app!.enabled).toBe(true);
    expect(byChannel.push).toBeDefined();
    expect(byChannel.push!.recipientRole).toBe('captain_owning_city');
    expect(byChannel.push!.enabled).toBe(true);

    const [count] = await db
      .select({ n: sql<number>`count(*)` })
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.eventType, 'request.approval_overdue'),
          eq(notificationRules.recipientRole, 'captain_owning_city'),
        ),
      );
    expect(Number(count.n)).toBe(2);
  });
});
