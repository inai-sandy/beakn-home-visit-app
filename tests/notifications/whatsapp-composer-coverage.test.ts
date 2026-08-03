import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WHATSAPP_COMPOSERS } from '@/lib/notifications/compose/whatsapp-events';

// =============================================================================
// HVA-306: every WhatsApp rule must have a composer behind it
// =============================================================================
//
// The bug this exists to prevent: `internal_items_dispatched_v1` and
// `internal_dispatch_advanced_v1` were referenced by notification_rules
// since HVA-240 but never registered in WHATSAPP_COMPOSERS. The channel
// adapter fails SOFT in that case — it logs `no_whatsapp_composer_*` and
// records the delivery as failed — so the gap was invisible from the
// outside. Flipping the rules on would have sent nothing at all.
//
// The hard invariant is on ENABLED rules: if a rule can fire, a composer
// must exist. Disabled rules are tracked separately below so a template
// awaiting Meta approval is visible rather than silently forgotten.
// =============================================================================

/**
 * Templates that are intentionally referenced by a DISABLED rule and have
 * no composer yet. Every one is blocked on Meta approval, not on code.
 *
 * Shrink this list as templates get drafted, submitted and approved — do
 * not grow it to make a failing test pass.
 */
const KNOWN_UNREGISTERED_PENDING_META: readonly string[] = [
  'internal_hard_warning_v1',
  'internal_portal_order_received_v1',
  'internal_support_ticket_received_v1',
  'internal_support_ticket_reply_v1',
];

/**
 * Every template_key referenced by a whatsapp notification_rules row, read
 * straight out of the migration SQL.
 *
 * Deliberately NOT read from the database: truncateAll() wipes
 * notification_rules between tests, so a DB query here returns nothing and
 * the assertion passes vacuously — which is exactly the kind of test that
 * lets a gap like HVA-306 survive.
 *
 * Rule rows look like:
 *   ('support.dispatch_recorded', 'whatsapp', 'exec_assigned', false, 'internal_items_dispatched_v1'),
 * so on any line mentioning 'whatsapp' the last quoted string is the
 * template key (NULL for the channels that don't use one).
 */
const CHANNEL_LITERALS = new Set([
  'in_app',
  'push',
  'whatsapp',
  'email',
  'discord',
]);

function whatsappTemplateKeysFromMigrations(): string[] {
  const dir = join(process.cwd(), 'db', 'migrations');
  const keys = new Set<string>();

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n')) {
      if (!line.includes("'whatsapp'")) continue;
      if (line.trimStart().startsWith('--')) continue;
      const quoted = line.match(/'([^']*)'/g);
      if (!quoted || quoted.length < 2) continue;
      const last = quoted[quoted.length - 1].slice(1, -1);
      // A line can list several channels, in which case the trailing
      // quoted value is another channel name rather than a template key.
      if (last.length === 0 || CHANNEL_LITERALS.has(last)) continue;
      keys.add(last);
    }
  }
  return [...keys];
}

describe('WhatsApp composer coverage', () => {
  it('finds the whatsapp rules in the migrations at all', () => {
    // Without this the two assertions below could pass on an empty set.
    const keys = whatsappTemplateKeysFromMigrations();
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toContain('internal_items_dispatched_v1');
  });

  it('registers the dispatch templates', async () => {
    // The HVA-306 deliverable. These are still rule-disabled pending Meta,
    // but the code side must be ready so flipping the flag is all it takes.
    expect(WHATSAPP_COMPOSERS.internal_items_dispatched_v1).toBeDefined();
    expect(WHATSAPP_COMPOSERS.internal_dispatch_advanced_v1).toBeDefined();
  });

  it('keeps the unregistered set to the documented Meta-pending list', () => {
    const keys = whatsappTemplateKeysFromMigrations();
    const missing = keys.filter((k) => !WHATSAPP_COMPOSERS[k]).sort();
    // If this fails with something NEW in `missing`, a rule was added
    // referencing a template nobody wrote a composer for — wire it up
    // rather than appending to the allow-list.
    expect(missing).toEqual([...KNOWN_UNREGISTERED_PENDING_META].sort());
  });
});

describe('dispatch composers produce a sendable template', () => {
  const baseContext = {
    requestId: '019abcde-cafe-7000-8000-00000000000b',
    customerName: 'Ramesh Kumar',
    itemSummary: '2× Kitchen Light, 1× Curtain Motor',
    dispatchedByName: 'Priya S',
    changedByName: 'Priya S',
  };

  it('fills every parameter slot for items dispatched', () => {
    const msg = WHATSAPP_COMPOSERS.internal_items_dispatched_v1({
      target: '+919999999999',
      context: baseContext,
      templateKey: 'internal_items_dispatched_v1',
      targetUserName: 'Arun Prakash',
    });

    expect(msg.name).toBe('internal_items_dispatched_v1');
    expect(msg.language.code).toBe('en');
    const params = msg.components[0].parameters;
    expect(params).toHaveLength(5);
    // Meta rejects blank parameters outright — none may be empty.
    for (const p of params) expect(p.text.length).toBeGreaterThan(0);
    expect(params[0].text).toBe('Arun'); // first name only
    expect(params[1].text).toBe('Ramesh Kumar');
    expect(params[4].text).toContain('/requests/');
  });

  it('words each stage of dispatch advanced', () => {
    const wordFor = (newStage: string) =>
      WHATSAPP_COMPOSERS.internal_dispatch_advanced_v1({
        target: '+919999999999',
        context: { ...baseContext, newStage },
        templateKey: 'internal_dispatch_advanced_v1',
        targetUserName: 'Arun Prakash',
      }).components[0].parameters[2].text;

    expect(wordFor('packed')).toBe('packed');
    expect(wordFor('handed_off')).toBe('handed over to the courier');
    expect(wordFor('delivered')).toBe('delivered');
  });

  it('never emits a blank parameter even with an empty context', () => {
    // Composers are deliberately permissive — a missing field must fall
    // back to readable copy, not an empty slot Meta will reject.
    for (const key of [
      'internal_items_dispatched_v1',
      'internal_dispatch_advanced_v1',
    ]) {
      const msg = WHATSAPP_COMPOSERS[key]({
        target: '+919999999999',
        context: {},
        templateKey: key,
        targetUserName: null,
      });
      for (const p of msg.components[0].parameters) {
        expect(p.text.length).toBeGreaterThan(0);
      }
    }
  });
});
