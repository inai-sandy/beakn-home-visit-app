import { eq } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';

import { db } from '@/db/client';
import { config } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { logEvent } from '@/lib/audit';
import { clearConfigCache } from '@/lib/config';
import { customerSupportPhoneUpdateSchema } from '@/lib/validators/admin-config';

// =============================================================================
// HVA-105 (extended): PATCH /api/admin/config/customer-support-phone
// =============================================================================
//
// Single-config-key editor. Updates the `customer_support_phone` row in the
// `config` table directly so we can carry a real super_admin actor into the
// audit row (lib/config.setConfig writes audit with actor_user_id=null per
// its line 130-131 TODO).
//
// The audit event_type is 'configuration_change' — already in the allow-list
// (see HVA-91/92 migration 0006 and the schema default in lib/config-schema.ts).
// No new event_type, no migration needed.
//
// VALIDATION GATES:
//   1. super_admin (requireSuperAdmin guard).
//   2. Zod: value is exactly +91 + 10 digits, OR blank.
//
// Stricter than the CONFIG_SCHEMA validation pattern (which allows spaces +
// punctuation) — this API is the only writer, so the stricter gate wins.
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

  // Read the current value (driver-side, not via getConfig — avoids any
  // cache staleness on the read leg).
  const [existing] = await db
    .select({ value: config.value })
    .from(config)
    .where(eq(config.key, KEY))
    .limit(1);
  // config rows are JSONB — strings come back as JSON-quoted strings.
  const before = typeof existing?.value === 'string' ? existing.value : '';

  if (before === next) {
    // No-op write: skip the UPDATE + audit. Mirrors the HVA-110 pattern.
    return NextResponse.json(
      { ok: true, value: next, changed: false },
      { status: 200 },
    );
  }

  try {
    // UPSERT: row exists in prod (HVA-17 seeded it), but the HVA-101 test
    // harness applies migrations only — the seed-config script doesn't
    // run there. UPSERT handles both paths with one statement.
    //
    // The `category` + `description` columns are notNull on the config
    // table; supply them here so the INSERT branch satisfies the constraints.
    // ON CONFLICT updates only `value` + `updatedAt`.
    await db
      .insert(config)
      .values({
        key: KEY,
        category: 'organization',
        description:
          'Customer-facing support phone number. Shown on the public tracking page and in customer-facing notification templates.',
        value: next,
      })
      .onConflictDoUpdate({
        target: config.key,
        set: { value: next, updatedAt: new Date() },
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

  // Invalidate the in-process getConfig cache so the next /track render
  // picks up the new value immediately.
  clearConfigCache();

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'configuration_change',
    actorUserId: actor.id,
    actorRole: 'super_admin',
    targetEntityType: 'config_key',
    targetEntityId: KEY,
    beforeState: { value: before },
    afterState: { value: next },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  return NextResponse.json(
    { ok: true, value: next, changed: true },
    { status: 200 },
  );
}
