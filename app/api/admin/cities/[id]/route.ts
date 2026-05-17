import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { cities } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { cityRoutingEmailUpdateSchema } from '@/lib/validators/admin-cities';

// =============================================================================
// HVA-110: PATCH /api/admin/cities/[id] — update captain_routing_email
// =============================================================================
//
// AUTH: super_admin only (requireSuperAdmin guard).
//
// VALIDATION GATES (each blocks the next):
//   1. Zod payload — captain_routing_email is RFC-email-or-null
//   2. City exists
//   3. City is NOT 'Other' — the Other row routes to super_admins by
//      design (HVA-42), and an admin-edited Other email would be silently
//      ignored. We reject at the API layer so the UI's disabled field
//      can't be bypassed.
//
// AUDIT: writes one row per PATCH with event_type='city_routing_email_updated',
// target_entity_type='city', target_entity_id=<cityId>, before/after carrying
// the column value. Migration 0007 added that event to audit_enabled_events.
// =============================================================================

const paramsSchema = z.object({ id: z.string().uuid() });

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: Ctx): Promise<NextResponse> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const actor = guard.session.user as { id: string };

  const paramsParsed = paramsSchema.safeParse(await ctx.params);
  if (!paramsParsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
  }
  const cityId = paramsParsed.data.id;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = cityRoutingEmailUpdateSchema.safeParse(bodyRaw);
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
  const { captainRoutingEmail } = parsed.data;

  const [existing] = await db
    .select({
      id: cities.id,
      name: cities.name,
      captainRoutingEmail: cities.captainRoutingEmail,
    })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'City not found' }, { status: 404 });
  }

  if (existing.name === 'Other') {
    return NextResponse.json(
      {
        ok: false,
        error:
          'The "Other" row routes to super_admins by design — editing its captain_routing_email has no effect.',
        fieldErrors: {
          captainRoutingEmail:
            'Other-city submissions route to super_admins. Field is fixed.',
        },
      },
      { status: 400 },
    );
  }

  const before = existing.captainRoutingEmail;
  const after = captainRoutingEmail;

  // No-op write — explicit early return saves an audit_log row + UPDATE.
  if (before === after) {
    return NextResponse.json(
      {
        ok: true,
        city: { id: existing.id, name: existing.name, captainRoutingEmail: after },
        changed: false,
      },
      { status: 200 },
    );
  }

  try {
    await db
      .update(cities)
      .set({ captainRoutingEmail: after, updatedAt: new Date() })
      .where(eq(cities.id, cityId));
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Service temporarily unavailable.',
      },
      { status: 503 },
    );
  }

  const reqHeaders = await headersFn();
  await logEvent({
    eventType: 'city_routing_email_updated',
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'city',
    targetEntityId: cityId,
    beforeState: { name: existing.name, captainRoutingEmail: before },
    afterState: { name: existing.name, captainRoutingEmail: after },
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // HVA-143: client Router Cache invalidation for cross-page nav.
  revalidatePath('/', 'layout');

  return NextResponse.json(
    {
      ok: true,
      city: { id: existing.id, name: existing.name, captainRoutingEmail: after },
      changed: true,
    },
    { status: 200 },
  );
}
