import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';

import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { USER_ROLES } from '@/lib/auth/roles';
import { getConfig, setConfig } from '@/lib/config';
import { monthlyExecTargetUpdateSchema } from '@/lib/validators/admin-config';

// =============================================================================
// PATCH /api/admin/config/monthly-exec-target
// =============================================================================
//
// Admin-only editor for `monthly_exec_target_paise` config key. The form
// sends rupees (e.g. 700000 = ₹7L); we convert to paise before
// persisting to match the rest of the money pipeline.
//
// Pattern mirrors /api/admin/config/customer-support-phone — same audit
// shape (setConfig with actor metadata writes a `configuration_change`
// audit row), same revalidatePath + no-op short-circuit.
// =============================================================================

const KEY = 'monthly_exec_target_paise';

export async function PATCH(req: Request): Promise<NextResponse> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return guard.response;
  const actor = guard.session.user as { id: string };

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  const parsed = monthlyExecTargetUpdateSchema.safeParse(bodyRaw);
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

  const nextPaise = parsed.data.valueRupees * 100;

  // No-op short-circuit.
  const before = await getConfig(KEY);
  if (before === nextPaise) {
    return NextResponse.json(
      { ok: true, valuePaise: nextPaise, changed: false },
      { status: 200 },
    );
  }

  const reqHeaders = await headersFn();
  try {
    await setConfig(KEY, nextPaise, {
      userId: actor.id,
      role: USER_ROLES.SUPER_ADMIN,
      ipAddress: reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: reqHeaders.get('user-agent'),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : 'Service temporarily unavailable.',
      },
      { status: 503 },
    );
  }

  revalidatePath('/', 'layout');

  return NextResponse.json(
    { ok: true, valuePaise: nextPaise, changed: true },
    { status: 200 },
  );
}
