import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';

import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { USER_ROLES } from '@/lib/auth/roles';
import { getConfig, setConfig } from '@/lib/config';
import { customerSupportPhoneUpdateSchema } from '@/lib/validators/admin-config';

// =============================================================================
// HVA-105: PATCH /api/admin/config/customer-support-phone
// =============================================================================
//
// HVA-112 simplified this handler. Previously it hit the config table
// directly (via Drizzle UPSERT) + wrote its own audit row because
// `lib/config.setConfig` historically wrote `actor_user_id = null`. With
// HVA-112's setConfig actor parameter, the route now uses
// `setConfig(KEY, value, { userId, role, ipAddress, userAgent })` and
// the audit row carries the super_admin attribution directly. No
// dual-write, no clearConfigCache (cache removed entirely).
//
// The audit event_type is 'configuration_change' — already in the
// allow-list (see HVA-91/92 migration 0006 + the schema default in
// lib/config-schema.ts). No new event_type, no migration needed.
//
// VALIDATION GATES:
//   1. super_admin (requireSuperAdmin guard).
//   2. Zod: value is exactly +91 + 10 digits, OR blank.
//
// Stricter than the CONFIG_SCHEMA validation pattern (which allows
// spaces + punctuation) — this API is the only writer, so the stricter
// gate wins.
// =============================================================================

const KEY = 'customer_support_phone';

export async function PATCH(req: Request): Promise<NextResponse> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const actor = guard.session.user as { id: string };

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = customerSupportPhoneUpdateSchema.safeParse(bodyRaw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return NextResponse.json(
      { ok: false, error: 'Some fields are invalid.', fieldErrors },
      { status: 400 },
    );
  }
  const next = parsed.data.value;

  // No-op short-circuit: avoid writing an audit row when the value
  // didn't actually change. Reads the current value via getConfig
  // (always-fresh post-HVA-112).
  const before = await getConfig(KEY);
  if (before === next) {
    return NextResponse.json(
      { ok: true, value: next, changed: false },
      { status: 200 },
    );
  }

  const reqHeaders = await headersFn();
  try {
    await setConfig(KEY, next, {
      userId: actor.id,
      role: USER_ROLES.SUPER_ADMIN,
      ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: reqHeaders.get('user-agent'),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Service temporarily unavailable.',
      },
      { status: 503 },
    );
  }

  // HVA-143: client Router Cache invalidation for cross-page nav.
  revalidatePath('/', 'layout');

  return NextResponse.json(
    { ok: true, value: next, changed: true },
    { status: 200 },
  );
}
