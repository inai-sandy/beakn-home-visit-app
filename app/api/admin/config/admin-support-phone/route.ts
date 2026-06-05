import { revalidatePath } from 'next/cache';
import { headers as headersFn } from 'next/headers';
import { NextResponse } from 'next/server';

import { requireSuperAdmin } from '@/lib/admin/auth-helper';
import { USER_ROLES } from '@/lib/auth/roles';
import { getConfig, setConfig } from '@/lib/config';
import { adminSupportPhoneUpdateSchema } from '@/lib/validators/admin-config';

// =============================================================================
// HVA-90: PATCH /api/admin/config/admin-support-phone
// =============================================================================
//
// Mirror of /api/admin/config/customer-support-phone — same shape,
// same validation, same audit emission (`configuration_change`). The
// only difference is the config key: `admin_support_phone` is read by
// the forgot-password modal so users with no in-app access can reach
// Sandeep / whoever owns the company.
// =============================================================================

const KEY = 'admin_support_phone';

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

  const parsed = adminSupportPhoneUpdateSchema.safeParse(bodyRaw);
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

  revalidatePath('/', 'layout');

  return NextResponse.json(
    { ok: true, value: next, changed: true },
    { status: 200 },
  );
}
