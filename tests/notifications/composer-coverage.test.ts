import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { statusTransitions } from '@/db/schema';
import {
  EMAIL_COMPOSERS,
  IN_APP_COMPOSERS,
} from '@/lib/notifications/compose';

// =============================================================================
// HVA-311: every non-WhatsApp rule needs a composer, every event needs a rule
// =============================================================================
//
// tests/notifications/whatsapp-composer-coverage.test.ts already guards the
// WhatsApp channel — it is the reason HVA-306 cannot happen again there.
// in_app, push and email had no equivalent, which is the same hole on a
// different channel: the adapters fail SOFT
// (`no_in_app_composer_for_<event>` / `no_email_composer_for_<event>`),
// record the delivery as failed, and nothing alerts.
//
// The second half of this file covers a quieter failure still. An event
// fired with NO matching rule produces rulesMatched=0 and an empty
// deliveries[] — it doesn't even leave a failed-delivery breadcrumb, so it
// is less visible than a missing composer. That is how
// `request.rejected_by_captain` and `status_rolled_back` came to be
// dispatched into the void.
//
// Reading strategy, and why it differs per table:
//   - notification_rules IS truncated between tests (SAFE_TRUNCATE_TABLES),
//     so a DB query returns nothing and every assertion would pass
//     vacuously. Read it from the migration SQL instead.
//   - status_transitions is NOT truncated — it is migration-seeded and
//     survives — so emits_event is read from the database, which is more
//     robust than parsing the mix of VALUES blocks and UPDATEs that set it.
// =============================================================================

const CHANNEL_LITERALS = new Set(['in_app', 'push', 'whatsapp', 'email', 'discord']);

interface RuleRow {
  eventType: string;
  channel: string;
}

/**
 * Every notification_rules row seeded by a migration, as (event_type, channel).
 *
 * Rows are written as:
 *   ('request.assigned', 'in_app', 'exec_assigned', true, NULL),
 * so on a line starting with '(' the first quoted value is the event type
 * and the second is the channel. Every event type in this codebase is
 * dot-namespaced, which keeps unrelated INSERT ... VALUES lines in other
 * migrations from being mistaken for rules.
 *
 * No migration ever DELETEs from notification_rules (verified), so the
 * union of inserts is the live rule set.
 */
function ruleRowsFromMigrations(): RuleRow[] {
  const dir = join(process.cwd(), 'db', 'migrations');
  const rows: RuleRow[] = [];

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('(')) continue;
      const quoted = trimmed.match(/'([^']*)'/g);
      if (!quoted || quoted.length < 2) continue;
      const eventType = quoted[0].slice(1, -1);
      const channel = quoted[1].slice(1, -1);
      if (!CHANNEL_LITERALS.has(channel)) continue;
      if (!eventType.includes('.')) continue;
      rows.push({ eventType, channel });
    }
  }
  return rows;
}

describe('in-app / push / email composer coverage', () => {
  it('finds the rules in the migrations at all', () => {
    // Canary: without this, every assertion below could pass on an empty
    // set — the exact way a broken parser hides the gap it exists to find.
    const rows = ruleRowsFromMigrations();
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.map((r) => r.eventType)).toContain('request.assigned');
  });

  it('registers an in-app composer for every in_app and push rule', () => {
    // push deliberately shares IN_APP_COMPOSERS (see channels/web-push.ts),
    // so one registry check covers both channels.
    const events = new Set(
      ruleRowsFromMigrations()
        .filter((r) => r.channel === 'in_app' || r.channel === 'push')
        .map((r) => r.eventType),
    );
    expect(events.size).toBeGreaterThan(10);

    const missing = [...events].filter((e) => !IN_APP_COMPOSERS[e]).sort();
    // A new name here means a rule was added for an event nobody wrote a
    // composer for. Wire up the composer — do not soften this assertion.
    expect(missing).toEqual([]);
  });

  it('registers an email composer for every email rule', () => {
    const events = new Set(
      ruleRowsFromMigrations()
        .filter((r) => r.channel === 'email')
        .map((r) => r.eventType),
    );
    const missing = [...events].filter((e) => !EMAIL_COMPOSERS[e]).sort();
    expect(missing).toEqual([]);
  });
});

/**
 * Transition events that currently fire with no notification_rules row.
 *
 * Both are duplicate names for an event that IS wired under a different
 * name, dispatched separately by the route handler:
 *   - status_rolled_back        → the route fires request.rolled_back
 *   - request.rejected_by_captain → the route fires request.rejected
 *
 * So neither is a missing notification today; each is a dead second name
 * whose dispatch matches nothing. HVA-316 aligns them, and must empty this
 * list when it does. Do not add to it to make a failure go away — a NEW
 * entry means a real notification is silently going nowhere.
 */
const KNOWN_UNWIRED_TRANSITION_EVENTS: readonly string[] = [
  'request.rejected_by_captain',
  'status_rolled_back',
];

describe('every status_transitions.emits_event has a rule behind it', () => {
  it('matches each emitted event to at least one notification rule', async () => {
    const rows = await db
      .select({ emitsEvent: statusTransitions.emitsEvent })
      .from(statusTransitions);

    const emitted = [
      ...new Set(
        rows
          .map((r) => r.emitsEvent)
          .filter((e): e is string => e !== null && e.length > 0),
      ),
    ];
    // status_transitions survives truncateAll, so this must be non-empty.
    expect(emitted.length).toBeGreaterThan(5);

    const ruleEvents = new Set(
      ruleRowsFromMigrations().map((r) => r.eventType),
    );
    const unwired = emitted.filter((e) => !ruleEvents.has(e)).sort();

    expect(unwired).toEqual([...KNOWN_UNWIRED_TRANSITION_EVENTS].sort());
  });
});
