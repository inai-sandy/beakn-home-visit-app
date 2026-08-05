import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONTEXT_ONLY_RECIPIENT_ROLES,
  ENGINE_RECIPIENT_ROLES,
  ROLE_TO_RECIPIENT_ROLES,
} from '@/lib/notifications/recipient-roles';

// =============================================================================
// HVA-327: a recipient role must never become unmanageable in silence
// =============================================================================
//
// The bug: `support_team_all` was added to the engine in HVA-240 and went
// live in notification_rules, but ROLE_TO_RECIPIENT_ROLES still carried
// `support: []`. Support staff received notifications that their settings
// page did not list — no way to see them, no way to switch them off. Nothing
// failed; the two lists just disagreed for months.
//
// Coverage argument: notification_rules can only usefully carry a
// recipient_role the ENGINE resolves — anything else falls through to
// `unknown recipient_role` and delivers to nobody. So asserting that every
// engine role is accounted for is the same as asserting every usable rule is
// accounted for, without depending on live notification_rules rows (which
// the per-worker DB baseline truncates, making any live-state assertion
// order-dependent and flaky by construction).
//
// Pure unit tests — no DB, matching tests/notifications/compose/
// wiring-composers.test.ts.
// =============================================================================

const ENGINE_PATH = join(process.cwd(), 'lib', 'notifications', 'engine.ts');

const RESOLVER_START = 'async function resolveRecipients(';
// The comment banner that immediately follows the resolver. If engine.ts is
// reorganised this anchor stops matching and the test fails loudly rather
// than quietly scanning the wrong region.
const RESOLVER_END = '// User-id → channel-specific address resolution';

/** The `case '...'` labels inside engine.ts:resolveRecipients. */
function engineSwitchCases(): string[] {
  const source = readFileSync(ENGINE_PATH, 'utf8');
  const start = source.indexOf(RESOLVER_START);
  expect(
    start,
    `could not find "${RESOLVER_START}" in engine.ts — this test scans that function by name`,
  ).toBeGreaterThan(-1);
  const end = source.indexOf(RESOLVER_END, start);
  expect(
    end,
    `could not find the banner after resolveRecipients in engine.ts — update RESOLVER_END`,
  ).toBeGreaterThan(start);

  const body = source.slice(start, end);
  const found = [...body.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]);
  // A resolver with no cases means the scan region is wrong, not that the
  // engine resolves nothing.
  expect(found.length).toBeGreaterThan(0);
  return found;
}

describe('recipient role coverage', () => {
  it('ENGINE_RECIPIENT_ROLES lists exactly the roles engine.ts resolves', () => {
    const fromSource = new Set(engineSwitchCases());
    const declared = new Set<string>(ENGINE_RECIPIENT_ROLES);

    const missing = [...fromSource].filter((r) => !declared.has(r));
    const stale = [...declared].filter((r) => !fromSource.has(r));

    expect(
      missing,
      'engine.ts resolves these but ENGINE_RECIPIENT_ROLES does not list them',
    ).toEqual([]);
    expect(
      stale,
      'ENGINE_RECIPIENT_ROLES lists these but engine.ts no longer resolves them',
    ).toEqual([]);
  });

  it('every engine recipient role is either user-manageable or recorded as context-only', () => {
    const manageable = new Set(
      Object.values(ROLE_TO_RECIPIENT_ROLES).flatMap((roles) => [...roles]),
    );

    const unaccounted = ENGINE_RECIPIENT_ROLES.filter(
      (role) =>
        !manageable.has(role) &&
        !Object.hasOwn(CONTEXT_ONLY_RECIPIENT_ROLES, role),
    );

    // Pre-fix this listed 'support_team_all' — reachable by the engine,
    // absent from every app role, and not declared context-only.
    expect(
      unaccounted,
      'add these to ROLE_TO_RECIPIENT_ROLES, or to CONTEXT_ONLY_RECIPIENT_ROLES with a reason',
    ).toEqual([]);
  });

  it('no role is both user-manageable and context-only', () => {
    const manageable = Object.values(ROLE_TO_RECIPIENT_ROLES).flatMap((r) => [
      ...r,
    ]);
    const both = manageable.filter((role) =>
      Object.hasOwn(CONTEXT_ONLY_RECIPIENT_ROLES, role),
    );
    expect(both, 'a role cannot be both manageable and context-only').toEqual(
      [],
    );
  });

  it('maps every recipient role to a role that can actually receive it', () => {
    // Guards against a typo silently adding an unreachable role name: every
    // value in the map must be something the engine can resolve.
    const declared = new Set<string>(ENGINE_RECIPIENT_ROLES);
    for (const [appRole, recipientRoles] of Object.entries(
      ROLE_TO_RECIPIENT_ROLES,
    )) {
      for (const recipientRole of recipientRoles) {
        expect(
          declared.has(recipientRole),
          `${appRole} maps to "${recipientRole}", which the engine cannot resolve`,
        ).toBe(true);
      }
    }
  });

  it('support staff can manage the notifications they actually receive', () => {
    // The specific regression: support_team_all rules are live in
    // production, so a support user's settings page must list them.
    expect(ROLE_TO_RECIPIENT_ROLES.support).toContain('support_team_all');
    expect(ROLE_TO_RECIPIENT_ROLES.support.length).toBeGreaterThan(0);
  });
});
