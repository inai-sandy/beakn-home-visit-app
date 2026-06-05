import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { cities } from '@/db/schema';
import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { validateDiscordWebhook } from '@/lib/admin/discord-webhook-validator';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { cityConfigUpdateSchema } from '@/lib/validators/admin-cities';

// =============================================================================
// HVA-110 + HVA-90: PATCH /api/admin/cities/[id]
// =============================================================================
//
// HVA-110 shipped with a single editable column: `captain_routing_email`.
// HVA-90 (this update) adds Discord webhook + Other-row routing email
// editing. Clients send only the fields they want to change; absent
// fields = no change.
//
// AUTH: super_admin only (requireSuperAdmin guard).
//
// VALIDATION GATES (in order; each can block the next):
//   1. Zod payload — all three fields preprocessed to string | null
//   2. City exists
//   3. Per-field admissibility:
//        captainRoutingEmail → forbidden on the 'Other' row (HVA-110)
//        otherRoutingEmail   → forbidden on every row EXCEPT 'Other'
//        discordWebhookUrl   → live Discord ping (real test message);
//                              if Discord rejects, surface the message
//                              inline as fieldErrors.discordWebhookUrl.
//
// AUDIT: one row per PATCH with event_type='city_config_updated' (HVA-90)
// or 'city_routing_email_updated' (HVA-110 legacy — kept when only the
// captain routing email changed, so old audit dashboards keep grouping).
// Before/after JSON carries all changed fields.
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
  const parsed = cityConfigUpdateSchema.safeParse(bodyRaw);
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
  const updates = parsed.data;

  // At least one field must be provided.
  if (
    updates.captainRoutingEmail === undefined &&
    updates.otherRoutingEmail === undefined &&
    updates.discordWebhookUrl === undefined
  ) {
    return NextResponse.json(
      { ok: false, error: 'No fields to update.' },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select({
      id: cities.id,
      name: cities.name,
      captainRoutingEmail: cities.captainRoutingEmail,
      otherRoutingEmail: cities.otherRoutingEmail,
      discordWebhookUrl: cities.discordWebhookUrl,
    })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'City not found' }, { status: 404 });
  }

  const isOther = existing.name === 'Other';

  // Admissibility checks per field. Preserves the HVA-110 error
  // message shape on the captain_routing_email-on-Other case so legacy
  // callers + tests (tests/admin/cities.test.ts) continue to match the
  // /Other.*super_admins/ pattern.
  if (isOther && updates.captainRoutingEmail !== undefined) {
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
  if (!isOther && updates.otherRoutingEmail !== undefined) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Only the "Other" row has an other_routing_email.',
        fieldErrors: {
          otherRoutingEmail:
            'This field is exclusive to the Other row.',
        },
      },
      { status: 400 },
    );
  }

  // Live Discord ping — only when the URL is non-null (clearing is OK
  // without a ping). Save is blocked if the ping fails.
  if (
    updates.discordWebhookUrl !== undefined &&
    updates.discordWebhookUrl !== null
  ) {
    const probe = await validateDiscordWebhook(updates.discordWebhookUrl);
    if (!probe.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Discord rejected the webhook URL.',
          fieldErrors: {
            discordWebhookUrl: probe.error ?? 'Webhook validation failed.',
          },
        },
        { status: 400 },
      );
    }
  }

  // Compute the changed-fields delta. Absent in `updates` = preserve;
  // present-with-same-value = no-op for that column.
  const updateSet: Record<string, unknown> = {};
  const before: Record<string, unknown> = { name: existing.name };
  const after: Record<string, unknown> = { name: existing.name };
  let anyChange = false;

  if (
    updates.captainRoutingEmail !== undefined &&
    updates.captainRoutingEmail !== existing.captainRoutingEmail
  ) {
    updateSet.captainRoutingEmail = updates.captainRoutingEmail;
    before.captainRoutingEmail = existing.captainRoutingEmail;
    after.captainRoutingEmail = updates.captainRoutingEmail;
    anyChange = true;
  }
  if (
    updates.otherRoutingEmail !== undefined &&
    updates.otherRoutingEmail !== existing.otherRoutingEmail
  ) {
    updateSet.otherRoutingEmail = updates.otherRoutingEmail;
    before.otherRoutingEmail = existing.otherRoutingEmail;
    after.otherRoutingEmail = updates.otherRoutingEmail;
    anyChange = true;
  }
  if (
    updates.discordWebhookUrl !== undefined &&
    updates.discordWebhookUrl !== existing.discordWebhookUrl
  ) {
    updateSet.discordWebhookUrl = updates.discordWebhookUrl;
    before.discordWebhookUrl = existing.discordWebhookUrl;
    after.discordWebhookUrl = updates.discordWebhookUrl;
    anyChange = true;
  }

  if (!anyChange) {
    return NextResponse.json(
      {
        ok: true,
        city: {
          id: existing.id,
          name: existing.name,
          captainRoutingEmail: existing.captainRoutingEmail,
          otherRoutingEmail: existing.otherRoutingEmail,
          discordWebhookUrl: existing.discordWebhookUrl,
        },
        changed: false,
      },
      { status: 200 },
    );
  }

  try {
    await db
      .update(cities)
      .set({ ...updateSet, updatedAt: new Date() })
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

  // Pick the legacy event type when ONLY captain_routing_email changed
  // — keeps HVA-110-era audit dashboards stable. New multi-field
  // changes use city_config_updated.
  const onlyRoutingEmailChanged =
    Object.keys(updateSet).length === 1 &&
    'captainRoutingEmail' in updateSet;
  const eventType = onlyRoutingEmailChanged
    ? 'city_routing_email_updated'
    : 'city_config_updated';

  const reqHeaders = await headersFn();
  await logEvent({
    eventType,
    actorUserId: actor.id,
    actorRole: USER_ROLES.SUPER_ADMIN,
    targetEntityType: 'city',
    targetEntityId: cityId,
    beforeState: before,
    afterState: after,
    ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: reqHeaders.get('user-agent'),
  });

  // HVA-143: client Router Cache invalidation for cross-page nav.
  revalidatePath('/', 'layout');

  return NextResponse.json(
    {
      ok: true,
      city: {
        id: existing.id,
        name: existing.name,
        captainRoutingEmail:
          'captainRoutingEmail' in updateSet
            ? (updateSet.captainRoutingEmail as string | null)
            : existing.captainRoutingEmail,
        otherRoutingEmail:
          'otherRoutingEmail' in updateSet
            ? (updateSet.otherRoutingEmail as string | null)
            : existing.otherRoutingEmail,
        discordWebhookUrl:
          'discordWebhookUrl' in updateSet
            ? (updateSet.discordWebhookUrl as string | null)
            : existing.discordWebhookUrl,
      },
      changed: true,
    },
    { status: 200 },
  );
}
