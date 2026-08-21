import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WHATSAPP_COMPOSERS } from '@/lib/notifications/compose/whatsapp-events';
import type { TemplateMessage } from '@/lib/whatsapp';

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
  // HVA-343 emptied this list: every template a live rule can reach now has
  // a composer behind it. Add to it only alongside a new rule whose template
  // is genuinely still with Meta.
];

/**
 * Template keys that appear in HISTORICAL migration files but that no current
 * rule points at any more. The parser below reads every .sql file ever
 * shipped, so a superseded name keeps showing up long after it stopped
 * meaning anything.
 *
 * `internal_hard_warning_v1` (HVA-343) was never a real template — no such
 * name has ever existed at the provider. Migration 0092 repointed the rule at
 * `hard_warning`, which had been APPROVED and unused since HVA-228.
 */
const RETIRED_TEMPLATE_KEYS: readonly string[] = ['internal_hard_warning_v1'];

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
    expect(missing).toEqual(
      [...KNOWN_UNREGISTERED_PENDING_META, ...RETIRED_TEMPLATE_KEYS].sort(),
    );
  });
});

/**
 * Body text parameters as plain strings.
 *
 * `components` and `parameters` are both optional on TemplateMessage, and
 * TemplateParameter is a union (text / image / document / video), so the
 * narrowing here is what makes the assertions type-safe. A composer that
 * emitted an image parameter would surface as a missing string rather
 * than a silent pass.
 */
function bodyTextParams(msg: TemplateMessage): string[] {
  const body = msg.components?.find((c) => c.type === 'body');
  expect(body, 'composer produced no body component').toBeDefined();
  return (body?.parameters ?? []).map((p) =>
    p.type === 'text' ? p.text : '',
  );
}

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
    const params = bodyTextParams(msg);
    expect(params).toHaveLength(5);
    // Meta rejects blank parameters outright — none may be empty.
    for (const text of params) expect(text.length).toBeGreaterThan(0);
    expect(params[0]).toBe('Arun'); // first name only
    expect(params[1]).toBe('Ramesh Kumar');
    expect(params[4]).toContain('/requests/');
  });

  it('words each stage of dispatch advanced', () => {
    const wordFor = (newStage: string) =>
      bodyTextParams(
        WHATSAPP_COMPOSERS.internal_dispatch_advanced_v1({
          target: '+919999999999',
          context: { ...baseContext, newStage },
          templateKey: 'internal_dispatch_advanced_v1',
          targetUserName: 'Arun Prakash',
        }),
      )[2];

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
      // HVA-343
      'hard_warning',
      'internal_portal_order_received_v1',
      'internal_support_ticket_received_v1',
      'internal_support_ticket_reply_v1',
      // HVA-345
      'internal_request_update_v1',
    ]) {
      const composer = WHATSAPP_COMPOSERS[key];
      expect(composer, `${key} is not registered`).toBeDefined();
      const params = bodyTextParams(
        composer!({
          target: '+919999999999',
          context: {},
          templateKey: key,
          targetUserName: null,
        }),
      );
      expect(params.length).toBeGreaterThan(0);
      for (const text of params) expect(text.length).toBeGreaterThan(0);
    }
  });
});

describe('HVA-319: the installation message states a real date', () => {
  it('renders the scheduled moment, not the generic fallback', () => {
    // visitMoment() looks the context key up BY NAME and falls back to "the
    // scheduled time" when it is missing. A composer wired to the wrong key
    // would still produce a valid, sendable, entirely useless message — the
    // customer would be told an installation is booked without being told
    // when. This asserts the wiring, not just that a param exists.
    const msg = WHATSAPP_COMPOSERS.installation_scheduled!({
      target: '+919999999999',
      context: {
        customerName: 'Ramesh Kumar',
        installationScheduledAt: '2026-08-12T10:00:00.000Z', // 15:30 IST
        trackingToken: 'tok_abc123',
      },
      templateKey: 'installation_scheduled',
      targetUserName: null,
    });

    expect(msg.name).toBe('installation_scheduled');
    const params = bodyTextParams(msg);
    for (const text of params) expect(text.length).toBeGreaterThan(0);

    const moment = params[1];
    expect(moment).not.toMatch(/the scheduled time/i);
    // IST is UTC+5:30 and never has DST, so 10:00Z is 15:30 on the 12th.
    expect(moment).toMatch(/12/);
  });

  it('degrades to readable copy when no date is in context', () => {
    // Requests scheduled before HVA-317 created the column have no datetime.
    // Meta rejects blank parameters outright, so the fallback must still be
    // non-empty rather than an empty slot.
    const msg = WHATSAPP_COMPOSERS.installation_scheduled!({
      target: '+919999999999',
      context: { customerName: 'Ramesh Kumar' },
      templateKey: 'installation_scheduled',
      targetUserName: null,
    });
    const params = bodyTextParams(msg);
    for (const text of params) expect(text.length).toBeGreaterThan(0);
  });
});


// =============================================================================
// HVA-343: the order + status composers
// =============================================================================

describe('HVA-343: hard_warning renders the approved 8-parameter body', () => {
  // The approved body reads:
  //   Hi {{1}}, ... hard warning {{2}}/5 ... Your {{3}} for {{4}} is {{5}}
  //   against a target of {{6}}. Specifically: {{7}} ... captain ({{8}}) ...
  // Parameter ORDER is the whole contract. Get it wrong and the exec is told
  // their target is their shortfall.
  const context = {
    execName: 'Arun Prakash',
    hardCount: 3,
    metricLabel: 'revenue',
    periodLabel: 'July 2026',
    currentValueText: '₹1,20,000',
    targetValueText: '₹3,00,000',
    reason: 'No visits logged in the last two weeks.',
    captainName: 'Meera Iyer',
  };

  it('places every value in the slot the approved body expects', () => {
    const msg = WHATSAPP_COMPOSERS.hard_warning!({
      target: '+919999999999',
      context,
      templateKey: 'hard_warning',
      targetUserName: 'Arun Prakash',
    });

    expect(msg.name).toBe('hard_warning');
    const params = bodyTextParams(msg);
    expect(params).toHaveLength(8);
    expect(params[0]).toBe('Arun');
    expect(params[1]).toBe('3');
    expect(params[2]).toBe('revenue');
    expect(params[3]).toBe('July 2026');
    expect(params[4]).toBe('₹1,20,000');
    expect(params[5]).toBe('₹3,00,000');
    expect(params[6]).toContain('No visits logged');
    expect(params[7]).toBe('Meera Iyer');
  });

  it('never renders an empty captain slot', () => {
    // The body prints this inside brackets, so a blank is both a Meta
    // rejection and an unreadable sentence.
    const params = bodyTextParams(
      WHATSAPP_COMPOSERS.hard_warning!({
        target: '+919999999999',
        context: { ...context, captainName: null },
        templateKey: 'hard_warning',
        targetUserName: 'Arun Prakash',
      }),
    );
    expect(params[7]).toBe('not assigned');
  });
});

describe('HVA-343: order received tells exec and captain what arrived', () => {
  const context = {
    requestId: '019abcde-cafe-7000-8000-00000000000b',
    customerName: 'Ramesh Kumar',
    orderNumber: 'CP-20260821-XY12AB',
    totalAmountInr: 8354,
    cityName: 'Hyderabad',
  };

  it('renders the order number, total and city', () => {
    const params = bodyTextParams(
      WHATSAPP_COMPOSERS.internal_portal_order_received_v1!({
        target: '+919999999999',
        context: { ...context, recipientRole: 'exec_assigned' },
        templateKey: 'internal_portal_order_received_v1',
        targetUserName: 'Arun Prakash',
      }),
    );
    expect(params).toHaveLength(6);
    expect(params[0]).toBe('Arun');
    expect(params[1]).toBe('Ramesh Kumar');
    expect(params[2]).toBe('CP-20260821-XY12AB');
    // CartPlus sends total_amount in RUPEES. Reading it as paise would
    // announce ₹84 for an ₹8,354 order.
    expect(params[3]).toContain('8,354');
    expect(params[4]).toBe('Hyderabad');
    expect(params[5]).toContain('/requests/');
  });

  it('sends the captain to the captain page, not the exec page', () => {
    const params = bodyTextParams(
      WHATSAPP_COMPOSERS.internal_portal_order_received_v1!({
        target: '+919999999999',
        context: { ...context, recipientRole: 'captain_owning_city' },
        templateKey: 'internal_portal_order_received_v1',
        targetUserName: 'Meera Iyer',
      }),
    );
    expect(params[5]).toContain('/captain/requests/');
  });
});

describe('HVA-343: support ticket composers', () => {
  it('names the customer and the subject on a new ticket', () => {
    const params = bodyTextParams(
      WHATSAPP_COMPOSERS.internal_support_ticket_received_v1!({
        target: '+919999999999',
        context: {
          requestId: '019abcde-cafe-7000-8000-00000000000b',
          customerName: 'Ramesh Kumar',
          subject: 'Installation delayed by a week',
        },
        templateKey: 'internal_support_ticket_received_v1',
        targetUserName: 'Arun Prakash',
      }),
    );
    expect(params).toHaveLength(4);
    expect(params[1]).toBe('Ramesh Kumar');
    expect(params[2]).toBe('Installation delayed by a week');
  });

  it('carries the reply preview', () => {
    const params = bodyTextParams(
      WHATSAPP_COMPOSERS.internal_support_ticket_reply_v1!({
        target: '+919999999999',
        context: {
          requestId: '019abcde-cafe-7000-8000-00000000000b',
          customerName: 'Ramesh Kumar',
          bodyPreview: 'Still waiting to hear about a new date',
        },
        templateKey: 'internal_support_ticket_reply_v1',
        targetUserName: 'Arun Prakash',
      }),
    );
    expect(params).toHaveLength(4);
    expect(params[2]).toBe('Still waiting to hear about a new date');
  });
});


describe('HVA-345: one template carries every order-update moment', () => {
  it('puts the "what happened" line in slot 3 and routes the link by role', () => {
    const params = bodyTextParams(
      WHATSAPP_COMPOSERS.internal_request_update_v1!({
        target: '+919999999999',
        context: {
          requestId: '019abcde-cafe-7000-8000-00000000000b',
          customerName: 'Ramesh Kumar',
          updateSummary: 'Order CP-20260821-XY12AB is confirmed in CartPlus.',
          recipientRole: 'captain_owning_city',
        },
        templateKey: 'internal_request_update_v1',
        targetUserName: 'Meera Iyer',
      }),
    );
    expect(params).toHaveLength(4);
    expect(params[0]).toBe('Meera');
    expect(params[1]).toBe('Ramesh Kumar');
    expect(params[2]).toContain('confirmed in CartPlus');
    expect(params[3]).toContain('/captain/requests/');
  });

  it('never leaves the summary blank — Meta rejects an empty parameter', () => {
    const params = bodyTextParams(
      WHATSAPP_COMPOSERS.internal_request_update_v1!({
        target: '+919999999999',
        context: { requestId: '019abcde-cafe-7000-8000-00000000000b' },
        templateKey: 'internal_request_update_v1',
        targetUserName: null,
      }),
    );
    for (const text of params) expect(text.length).toBeGreaterThan(0);
  });
});
